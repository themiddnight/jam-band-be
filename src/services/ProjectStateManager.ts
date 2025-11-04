import { EventEmitter } from 'events';
import type {
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  AudioFileRecord,
  MarkerRecord,
  ProjectChangeRecord,
  CompleteProjectState,
  ProjectChangeType,
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateTrackRequest,
  UpdateTrackRequest,
  CreateRegionRequest,
  UpdateRegionRequest,
  ProjectSettings,
} from '../types/daw';
import { ProjectDatabase } from './ProjectDatabase';
import { loggingService } from './LoggingService';
import { CacheService } from './CacheService';

/**
 * Project State Manager handles real-time project state management
 * Provides instant synchronization for new users and real-time persistence
 */
export class ProjectStateManager extends EventEmitter {
  private static instance: ProjectStateManager;
  private database: ProjectDatabase;
  private cacheService: CacheService;
  private saveQueue = new Map<string, NodeJS.Timeout>();
  private readonly SAVE_DEBOUNCE_MS = 1000; // 1 second debounce for saves
  private readonly CACHE_TTL = 300; // 5 minutes cache TTL

  private constructor() {
    super();
    this.database = ProjectDatabase.getInstance();
    this.cacheService = CacheService.getInstance();
  }

  static getInstance(): ProjectStateManager {
    if (!ProjectStateManager.instance) {
      ProjectStateManager.instance = new ProjectStateManager();
    }
    return ProjectStateManager.instance;
  }

  async initialize(): Promise<void> {
    await this.database.initialize();
    loggingService.logInfo('ProjectStateManager initialized');
  }

  // ============================================================================
  // Project Operations
  // ============================================================================

  async createProject(roomId: string, userId: string, request: CreateProjectRequest): Promise<ProjectRecord> {
    const projectData: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastSaved' | 'version'> = {
      name: request.name,
      roomId,
      createdBy: userId,
      tempo: request.tempo || 120,
      timeSignatureNumerator: request.timeSignature?.numerator || 4,
      timeSignatureDenominator: request.timeSignature?.denominator || 4,
      length: request.length || 32,
      settings: {
        autoSave: true,
        autoSaveInterval: 5,
        snapToGrid: true,
        gridResolution: 0.25,
        defaultTrackHeight: 64,
        showWaveforms: true,
        showMIDINotes: true,
        ...request.settings,
      },
      collaborators: [userId],
    };

    const project = await this.database.createProject(projectData);

    // Record creation change
    await this.recordChange(project.id, userId, 'project_create', {
      project: project,
    });

    // Cache the new project
    this.cacheProjectState(project.id);

    // Emit event for real-time updates
    this.emit('project_created', { projectId: project.id, roomId, userId });

    loggingService.logInfo('Project created', { projectId: project.id, roomId, userId });
    return project;
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    // Try cache first
    const cacheKey = `project:${projectId}`;
    const cached = this.cacheService.get<ProjectRecord>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get from database
    const project = await this.database.getProject(projectId);
    if (project) {
      this.cacheService.set(cacheKey, project, this.CACHE_TTL);
    }

    return project;
  }

  async updateProject(projectId: string, userId: string, updates: UpdateProjectRequest): Promise<ProjectRecord | null> {
    const existingProject = await this.getProject(projectId);
    if (!existingProject) return null;

    // Prepare update data
    const updateData: Partial<ProjectRecord> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.tempo !== undefined) updateData.tempo = updates.tempo;
    if (updates.timeSignatureNumerator !== undefined) updateData.timeSignatureNumerator = updates.timeSignatureNumerator;
    if (updates.timeSignatureDenominator !== undefined) updateData.timeSignatureDenominator = updates.timeSignatureDenominator;
    if (updates.length !== undefined) updateData.length = updates.length;
    if (updates.settings !== undefined) {
      updateData.settings = { ...existingProject.settings, ...updates.settings };
    }
    if (updates.clickTrackSettings !== undefined) updateData.clickTrackSettings = updates.clickTrackSettings;

    const updatedProject = await this.database.updateProject(projectId, updateData);
    if (!updatedProject) return null;

    // Record change
    await this.recordChange(projectId, userId, 'project_update', {
      updates: updateData,
    }, {
      previous: existingProject,
    });

    // Invalidate cache
    this.cacheService.del(`project:${projectId}`);

    // Schedule save and emit event
    this.scheduleSave(projectId, userId);
    this.emit('project_updated', { projectId, userId, updates: updateData });

    return updatedProject;
  }

  async deleteProject(projectId: string, userId: string): Promise<boolean> {
    const project = await this.getProject(projectId);
    if (!project) return false;

    const success = await this.database.deleteProject(projectId);
    if (success) {
      // Record deletion
      await this.recordChange(projectId, userId, 'project_delete', {
        projectId,
      });

      // Clear cache
      this.invalidateProjectCache(projectId);

      // Emit event
      this.emit('project_deleted', { projectId, userId });

      loggingService.logInfo('Project deleted', { projectId, userId });
    }

    return success;
  }

  // ============================================================================
  // Track Operations
  // ============================================================================

  async createTrack(projectId: string, userId: string, request: CreateTrackRequest): Promise<TrackRecord> {
    // Get next order number
    const existingTracks = await this.database.getTracksByProject(projectId);
    const nextOrder = existingTracks.length > 0 ? Math.max(...existingTracks.map(t => t.order)) + 1 : 0;

    const trackData: Omit<TrackRecord, 'id' | 'createdAt' | 'updatedAt'> = {
      projectId,
      name: request.name,
      type: request.type,
      color: request.color || this.getDefaultTrackColor(existingTracks.length),
      order: nextOrder,
      height: 64,
      muted: false,
      soloed: false,
      volume: 1.0,
      pan: 0,
      ...(request.instrumentId && { instrumentId: request.instrumentId }),
      ...(request.type === 'midi' && { midiChannel: 0 }),
      settings: {
        recordEnabled: false,
        monitorInput: false,
        frozen: false,
        ...request.settings,
      },
      createdBy: userId,
    };

    const track = await this.database.createTrack(trackData);

    // Record change
    await this.recordChange(projectId, userId, 'track_create', {
      track: track,
    });

    // Schedule save and emit event
    this.scheduleSave(projectId, userId);
    this.emit('track_created', { projectId, trackId: track.id, userId });

    return track;
  }

  async updateTrack(trackId: string, userId: string, updates: UpdateTrackRequest): Promise<TrackRecord | null> {
    const existingTrack = await this.database.getTrack(trackId);
    if (!existingTrack) return null;

    const updatedTrack = await this.database.updateTrack(trackId, updates as Partial<TrackRecord>);
    if (!updatedTrack) return null;

    // Record change
    await this.recordChange(existingTrack.projectId, userId, 'track_update', {
      trackId,
      updates,
    }, {
      previous: existingTrack,
    });

    // Schedule save and emit event
    this.scheduleSave(existingTrack.projectId, userId);
    this.emit('track_updated', { projectId: existingTrack.projectId, trackId, userId, updates });

    return updatedTrack;
  }

  async deleteTrack(trackId: string, userId: string): Promise<boolean> {
    const track = await this.database.getTrack(trackId);
    if (!track) return false;

    const success = await this.database.deleteTrack(trackId);
    if (success) {
      // Record change
      await this.recordChange(track.projectId, userId, 'track_delete', {
        trackId,
      });

      // Schedule save and emit event
      this.scheduleSave(track.projectId, userId);
      this.emit('track_deleted', { projectId: track.projectId, trackId, userId });
    }

    return success;
  }

  async getTracksByProject(projectId: string): Promise<TrackRecord[]> {
    return this.database.getTracksByProject(projectId);
  }

  // ============================================================================
  // Region Operations
  // ============================================================================

  async createRegion(projectId: string, userId: string, request: CreateRegionRequest): Promise<RegionRecord> {
    const regionData: Omit<RegionRecord, 'id' | 'createdAt' | 'updatedAt'> = {
      trackId: request.trackId,
      projectId,
      type: request.type,
      startTime: request.startTime,
      duration: request.duration,
      offset: 0,
      name: request.name || `${request.type} Region`,
      color: request.type === 'midi' ? '#3b82f6' : '#10b981',
      selected: false,
      muted: false,
      ...(request.notes && { notes: request.notes }),
      ...(request.quantization !== undefined && { quantization: request.quantization }),
      ...(request.velocity !== undefined && { velocity: request.velocity }),
      ...(request.audioFileId && { audioFileId: request.audioFileId }),
      fadeIn: request.fadeIn || 0,
      fadeOut: request.fadeOut || 0,
      gain: request.gain || 1.0,
      pitch: request.pitch || 0,
      timeStretch: request.timeStretch || 1.0,
      settings: {
        showNotes: true,
        noteHeight: 4,
        velocityOpacity: true,
        colorByVelocity: false,
        colorByPitch: true,
        showWaveform: true,
        waveformDetail: 'medium',
        normalizeDisplay: false,
        showSpectrum: false,
        ...request.settings,
      },
      createdBy: userId,
    };

    const region = await this.database.createRegion(regionData);

    // Record change
    await this.recordChange(projectId, userId, 'region_create', {
      region: region,
    });

    // Schedule save and emit event
    this.scheduleSave(projectId, userId);
    this.emit('region_created', { projectId, regionId: region.id, trackId: request.trackId, userId });

    return region;
  }

  async updateRegion(regionId: string, userId: string, updates: UpdateRegionRequest): Promise<RegionRecord | null> {
    const existingRegion = await this.database.getRegion(regionId);
    if (!existingRegion) return null;

    const updatedRegion = await this.database.updateRegion(regionId, updates);
    if (!updatedRegion) return null;

    // Record change
    await this.recordChange(existingRegion.projectId, userId, 'region_update', {
      regionId,
      updates,
    }, {
      previous: existingRegion,
    });

    // Schedule save and emit event
    this.scheduleSave(existingRegion.projectId, userId);
    this.emit('region_updated', { projectId: existingRegion.projectId, regionId, userId, updates });

    return updatedRegion;
  }

  async deleteRegion(regionId: string, userId: string): Promise<boolean> {
    const region = await this.database.getRegion(regionId);
    if (!region) return false;

    const success = await this.database.deleteRegion(regionId);
    if (success) {
      // Record change
      await this.recordChange(region.projectId, userId, 'region_delete', {
        regionId,
      });

      // Schedule save and emit event
      this.scheduleSave(region.projectId, userId);
      this.emit('region_deleted', { projectId: region.projectId, regionId, userId });
    }

    return success;
  }

  // ============================================================================
  // Audio File Operations
  // ============================================================================

  async createAudioFile(audioFile: Omit<AudioFileRecord, 'id' | 'uploadedAt'>): Promise<AudioFileRecord> {
    const newAudioFile = await this.database.createAudioFile(audioFile);

    // Record change
    await this.recordChange(audioFile.projectId, audioFile.uploadedBy, 'audio_file_upload', {
      audioFile: newAudioFile,
    });

    // Schedule save and emit event
    this.scheduleSave(audioFile.projectId, audioFile.uploadedBy);
    this.emit('audio_file_created', { projectId: audioFile.projectId, audioFileId: newAudioFile.id, userId: audioFile.uploadedBy });

    return newAudioFile;
  }

  async getAudioFilesByProject(projectId: string): Promise<AudioFileRecord[]> {
    return this.database.getAudioFilesByProject(projectId);
  }

  // ============================================================================
  // Complete State Operations
  // ============================================================================

  async getCompleteProjectState(projectId: string): Promise<CompleteProjectState | null> {
    // Try cache first
    const cacheKey = `complete_state:${projectId}`;
    const cached = this.cacheService.get<CompleteProjectState>(cacheKey);
    if (cached) {
      return cached;
    }

    // Get from database
    const state = await this.database.getCompleteProjectState(projectId);
    if (state) {
      // Cache for shorter time since this is large data
      this.cacheService.set(cacheKey, state, 60); // 1 minute cache
    }

    return state;
  }

  async getProjectsByRoom(roomId: string): Promise<ProjectRecord[]> {
    return this.database.getProjectsByRoom(roomId);
  }

  // ============================================================================
  // Change Tracking
  // ============================================================================

  async recordChange(
    projectId: string,
    userId: string,
    changeType: ProjectChangeType,
    data: any,
    previousData?: any
  ): Promise<ProjectChangeRecord> {
    const project = await this.getProject(projectId);
    const version = project ? project.version : 1;

    return this.database.recordChange({
      projectId,
      userId,
      changeType,
      data,
      previousData,
      version,
    });
  }

  async getChangesSince(projectId: string, timestamp: Date): Promise<ProjectChangeRecord[]> {
    return this.database.getChangesSince(projectId, timestamp);
  }

  async getRecentChanges(projectId: string, limit: number = 50): Promise<ProjectChangeRecord[]> {
    return this.database.getChangesByProject(projectId, limit);
  }

  // Expose database for other services
  getDatabase(): ProjectDatabase {
    return this.database;
  }

  // ============================================================================
  // Real-time Save Operations
  // ============================================================================

  private scheduleSave(projectId: string, userId: string): void {
    // Clear existing timeout
    const existingTimeout = this.saveQueue.get(projectId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new save
    const timeout = setTimeout(async () => {
      try {
        await this.performSave(projectId, userId);
        this.saveQueue.delete(projectId);
      } catch (error) {
        loggingService.logError(error instanceof Error ? error : new Error('Failed to perform scheduled save'), { projectId, userId });
      }
    }, this.SAVE_DEBOUNCE_MS);

    this.saveQueue.set(projectId, timeout);
  }

  private async performSave(projectId: string, userId: string): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) return;

    // Update last saved timestamp
    await this.database.updateProject(projectId, {
      lastSaved: new Date(),
    });

    // Invalidate cache to ensure fresh data
    this.invalidateProjectCache(projectId);

    // Emit save event
    this.emit('project_saved', { projectId, userId, timestamp: new Date() });

    loggingService.logInfo('Project auto-saved', { projectId, userId });
  }

  async forceSave(projectId: string, userId: string): Promise<void> {
    // Cancel any pending save
    const existingTimeout = this.saveQueue.get(projectId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.saveQueue.delete(projectId);
    }

    // Perform immediate save
    await this.performSave(projectId, userId);
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  private async cacheProjectState(projectId: string): Promise<void> {
    try {
      const state = await this.database.getCompleteProjectState(projectId);
      if (state) {
        this.cacheService.set(`complete_state:${projectId}`, state, 60);
      }
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to cache project state'), { projectId });
    }
  }

  private invalidateProjectCache(projectId: string): void {
    this.cacheService.del(`project:${projectId}`);
    this.cacheService.del(`complete_state:${projectId}`);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getDefaultTrackColor(index: number): string {
    const colors = [
      '#ef4444', // red
      '#3b82f6', // blue
      '#10b981', // green
      '#8b5cf6', // purple
      '#f59e0b', // amber
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#84cc16', // lime
    ];
    return colors[index % colors.length] || '#ef4444';
  }

  async getStats(): Promise<{
    projects: number;
    tracks: number;
    regions: number;
    audioFiles: number;
    markers: number;
    changes: number;
  }> {
    return this.database.getStats();
  }

  // ============================================================================
  // Cleanup Operations
  // ============================================================================

  async cleanup(): Promise<void> {
    // Clear any pending saves
    for (const timeout of this.saveQueue.values()) {
      clearTimeout(timeout);
    }
    this.saveQueue.clear();

    // Clean up old changes (keep last 30 days)
    const stats = await this.database.getStats();
    loggingService.logInfo('ProjectStateManager cleanup completed', { stats });
  }
}