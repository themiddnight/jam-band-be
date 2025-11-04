import { EventEmitter } from 'events';
import type {
  CompleteProjectState,
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  AudioFileRecord,
} from '../types/daw';
import { ProjectStateManager } from './ProjectStateManager';
import { AudioFileStorageService } from './AudioFileStorageService';
import { AudioFileSyncService } from './AudioFileSyncService';
import { CacheService } from './CacheService';
import { loggingService } from './LoggingService';

/**
 * Instant Sync Service handles new user onboarding with complete project state delivery
 * Ensures new users receive all project data within 5 seconds of joining
 */
export class InstantSyncService extends EventEmitter {
  private static instance: InstantSyncService;
  private projectStateManager: ProjectStateManager;
  private audioFileStorageService: AudioFileStorageService;
  private audioFileSyncService: AudioFileSyncService;
  private cacheService: CacheService;
  private readonly SYNC_TIMEOUT_MS = 5000; // 5 seconds
  private readonly CRITICAL_DATA_TIMEOUT_MS = 1000; // 1 second for critical data

  private constructor() {
    super();
    this.projectStateManager = ProjectStateManager.getInstance();
    this.audioFileStorageService = AudioFileStorageService.getInstance();
    this.audioFileSyncService = AudioFileSyncService.getInstance();
    this.cacheService = CacheService.getInstance();
  }

  static getInstance(): InstantSyncService {
    if (!InstantSyncService.instance) {
      InstantSyncService.instance = new InstantSyncService();
    }
    return InstantSyncService.instance;
  }

  // ============================================================================
  // New User Onboarding
  // ============================================================================

  async onUserJoinRoom(userId: string, roomId: string): Promise<void> {
    try {
      loggingService.logInfo('User joining room - starting instant sync', { userId, roomId });

      // Get all projects for the room
      const projects = await this.projectStateManager.getProjectsByRoom(roomId);
      
      if (projects.length === 0) {
        loggingService.logInfo('No projects found for room', { userId, roomId });
        this.emit('user_sync_completed', { userId, roomId, projectCount: 0 });
        return;
      }

      // Start sync process for each project
      const syncPromises = projects.map(project => 
        this.syncProjectToUser(userId, project.id)
      );

      // Wait for all syncs to complete or timeout
      await Promise.allSettled(syncPromises);

      loggingService.logInfo('User sync completed', { userId, roomId, projectCount: projects.length });
      this.emit('user_sync_completed', { userId, roomId, projectCount: projects.length });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to sync user to room'), { userId, roomId });
      this.emit('user_sync_failed', { userId, roomId, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }

  async syncProjectToUser(userId: string, projectId: string): Promise<void> {
    const startTime = Date.now();
    const syncId = this.recordSyncStart(userId, projectId);
    
    try {
      // Check if complete state is cached first
      let completeState = await this.getCachedProjectState(projectId);
      
      if (completeState) {
        this.recordCacheHit();
        
        // Deliver cached complete state immediately
        await this.deliverCompleteState(userId, projectId, completeState);
        
        const totalTime = Date.now() - startTime;
        const projectSize = this.calculateProjectSize(completeState);
        
        this.recordSyncSuccess(syncId, totalTime, projectSize);
        
        loggingService.logInfo('Complete cached project state delivered', { 
          userId, 
          projectId, 
          totalTimeMs: totalTime,
          projectSize,
        });

        // Still verify state consistency
        await this.verifyUserState(userId, projectId);
        return;
      }

      this.recordCacheMiss();

      // Step 1: Load critical data first (project, tracks structure)
      const criticalData = await this.loadCriticalProjectData(projectId);
      
      // Send critical data immediately
      await this.deliverCriticalData(userId, projectId, criticalData);
      
      const criticalDataTime = Date.now() - startTime;
      loggingService.logInfo('Critical data delivered', { 
        userId, 
        projectId, 
        timeMs: criticalDataTime 
      });

      // Step 2: Load remaining data (regions, audio files)
      const remainingData = await this.loadRemainingProjectData(projectId);
      
      // Send remaining data
      await this.deliverRemainingData(userId, projectId, remainingData);
      
      const totalTime = Date.now() - startTime;
      
      // Calculate project size for performance tracking
      completeState = await this.projectStateManager.getCompleteProjectState(projectId);
      const projectSize = completeState ? this.calculateProjectSize(completeState) : 0;
      
      this.recordSyncSuccess(syncId, totalTime, projectSize);
      
      loggingService.logInfo('Complete project sync delivered', { 
        userId, 
        projectId, 
        totalTimeMs: totalTime,
        projectSize,
      });

      // Step 3: Verify state consistency
      await this.verifyUserState(userId, projectId);

      // Cache the complete state for future users
      if (completeState) {
        await this.cacheCompleteProjectState(projectId);
      }

    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.recordSyncFailure(syncId, error);
      
      loggingService.logError(error instanceof Error ? error : new Error('Failed to sync project to user'), { 
        userId, 
        projectId, 
        timeMs: totalTime
      });
      throw error;
    }
  }

  private async deliverCompleteState(
    userId: string,
    projectId: string,
    completeState: CompleteProjectState
  ): Promise<void> {
    // Deliver complete state in optimized chunks
    
    // 1. Critical data first
    await this.deliverCriticalData(userId, projectId, {
      project: completeState.project,
      tracks: completeState.tracks,
    });

    // 2. Remaining data
    await this.deliverRemainingData(userId, projectId, {
      regions: completeState.regions,
      audioFiles: completeState.audioFiles,
      markers: completeState.markers,
    });

    loggingService.logInfo('Complete cached state delivered to user', {
      userId,
      projectId,
      trackCount: completeState.tracks.length,
      regionCount: completeState.regions.length,
      audioFileCount: completeState.audioFiles.length,
    });
  }

  // ============================================================================
  // Critical Data Loading (Project + Tracks)
  // ============================================================================

  private async loadCriticalProjectData(projectId: string): Promise<{
    project: ProjectRecord;
    tracks: TrackRecord[];
  }> {
    const cacheKey = `critical_data:${projectId}`;
    
    // Try cache first
    const cached = this.cacheService.get<{ project: ProjectRecord; tracks: TrackRecord[] }>(cacheKey);
    if (cached) {
      this.recordCacheHit();
      return cached;
    }

    this.recordCacheMiss();

    // Load from database
    const [project, tracks] = await Promise.all([
      this.projectStateManager.getProject(projectId),
      this.projectStateManager.getTracksByProject(projectId),
    ]);

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const criticalData = { project, tracks };
    
    // Cache for quick access
    this.cacheService.set(cacheKey, criticalData, 300); // 5 minutes

    return criticalData;
  }

  private async deliverCriticalData(
    userId: string, 
    projectId: string, 
    data: { project: ProjectRecord; tracks: TrackRecord[] }
  ): Promise<void> {
    // Emit critical data event for real-time delivery
    this.emit('deliver_critical_data', {
      userId,
      projectId,
      project: data.project,
      tracks: data.tracks,
      timestamp: new Date(),
    });

    // Log delivery
    loggingService.logInfo('Critical data delivered to user', {
      userId,
      projectId,
      trackCount: data.tracks.length,
    });
  }

  // ============================================================================
  // Remaining Data Loading (Regions + Audio Files)
  // ============================================================================

  private async loadRemainingProjectData(projectId: string): Promise<{
    regions: RegionRecord[];
    audioFiles: AudioFileRecord[];
    markers: any[];
  }> {
    const cacheKey = `remaining_data:${projectId}`;
    
    // Try cache first
    const cached = this.cacheService.get<{
      regions: RegionRecord[];
      audioFiles: AudioFileRecord[];
      markers: any[];
    }>(cacheKey);
    if (cached) {
      this.recordCacheHit();
      return cached;
    }

    this.recordCacheMiss();

    // Load from database
    const database = this.projectStateManager.getDatabase();
    const [regions, audioFiles, markers] = await Promise.all([
      database.getRegionsByProject(projectId),
      this.projectStateManager.getAudioFilesByProject(projectId),
      database.getMarkersByProject(projectId),
    ]);

    const remainingData = { regions, audioFiles, markers };
    
    // Cache for quick access
    this.cacheService.set(cacheKey, remainingData, 180); // 3 minutes

    return remainingData;
  }

  private async deliverRemainingData(
    userId: string,
    projectId: string,
    data: {
      regions: RegionRecord[];
      audioFiles: AudioFileRecord[];
      markers: any[];
    }
  ): Promise<void> {
    // Prioritize visible timeline data
    const visibleRegions = this.prioritizeVisibleRegions(data.regions);
    
    // Deliver in chunks to avoid overwhelming the connection
    const chunkSize = 50;
    
    // Send regions in chunks
    for (let i = 0; i < visibleRegions.length; i += chunkSize) {
      const regionChunk = visibleRegions.slice(i, i + chunkSize);
      
      this.emit('deliver_regions_chunk', {
        userId,
        projectId,
        regions: regionChunk,
        chunkIndex: Math.floor(i / chunkSize),
        totalChunks: Math.ceil(visibleRegions.length / chunkSize),
        timestamp: new Date(),
      });

      // Small delay between chunks to prevent overwhelming
      if (i + chunkSize < visibleRegions.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Send audio file metadata (not the actual files yet)
    this.emit('deliver_audio_metadata', {
      userId,
      projectId,
      audioFiles: data.audioFiles,
      timestamp: new Date(),
    });

    // Send markers
    this.emit('deliver_markers', {
      userId,
      projectId,
      markers: data.markers,
      timestamp: new Date(),
    });

    // Start audio file preloading for high-priority files using the sync service
    this.audioFileSyncService.preloadAudioFilesForProject(projectId, userId, 'high');

    loggingService.logInfo('Remaining data delivered to user', {
      userId,
      projectId,
      regionCount: data.regions.length,
      audioFileCount: data.audioFiles.length,
      markerCount: data.markers.length,
    });
  }

  // ============================================================================
  // Audio File Preloading
  // ============================================================================

  private async preloadHighPriorityAudioFiles(
    userId: string,
    projectId: string,
    audioFiles: AudioFileRecord[]
  ): Promise<void> {
    // Sort by priority (smaller files first, recently used, etc.)
    const prioritizedFiles = audioFiles
      .filter(af => af.processed) // Only preload processed files
      .sort((a, b) => {
        // Prioritize smaller files for faster loading
        if (a.size !== b.size) return a.size - b.size;
        // Then by upload date (newer first)
        return b.uploadedAt.getTime() - a.uploadedAt.getTime();
      })
      .slice(0, 10); // Limit to top 10 files

    // Preload files asynchronously
    for (const audioFile of prioritizedFiles) {
      this.preloadAudioFileAsync(userId, projectId, audioFile);
    }
  }

  private async preloadAudioFileAsync(
    userId: string,
    projectId: string,
    audioFile: AudioFileRecord
  ): Promise<void> {
    try {
      // Get file buffer
      const fileBuffer = await this.audioFileStorageService.getAudioFile(audioFile.id);
      if (!fileBuffer) return;

      // Emit preload event
      this.emit('preload_audio_file', {
        userId,
        projectId,
        audioFileId: audioFile.id,
        filename: audioFile.filename,
        size: audioFile.size,
        buffer: fileBuffer,
        timestamp: new Date(),
      });

      loggingService.logInfo('Audio file preloaded for user', {
        userId,
        projectId,
        audioFileId: audioFile.id,
        filename: audioFile.filename,
        size: audioFile.size,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to preload audio file'), {
        userId,
        projectId,
        audioFileId: audioFile.id,
      });
    }
  }

  // ============================================================================
  // State Verification and Consistency Checking
  // ============================================================================

  private async verifyUserState(userId: string, projectId: string): Promise<void> {
    try {
      // Get complete state for verification
      const completeState = await this.projectStateManager.getCompleteProjectState(projectId);
      if (!completeState) return;

      // Create state checksum for integrity verification
      const stateChecksum = this.calculateStateChecksum(completeState);

      // Emit verification request
      this.emit('verify_user_state', {
        userId,
        projectId,
        expectedState: {
          projectVersion: completeState.project.version,
          trackCount: completeState.tracks.length,
          regionCount: completeState.regions.length,
          audioFileCount: completeState.audioFiles.length,
          markerCount: completeState.markers.length,
          checksum: stateChecksum,
        },
        timestamp: new Date(),
      });

      loggingService.logInfo('State verification requested for user', {
        userId,
        projectId,
        version: completeState.project.version,
        checksum: stateChecksum,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to verify user state'), {
        userId,
        projectId,
      });
    }
  }

  async verifyStateConsistency(
    userId: string,
    projectId: string,
    clientState: {
      projectVersion: number;
      trackCount: number;
      regionCount: number;
      audioFileCount: number;
      markerCount: number;
      checksum?: string;
    }
  ): Promise<{
    isConsistent: boolean;
    differences: string[];
    serverState?: any;
  }> {
    try {
      const serverState = await this.projectStateManager.getCompleteProjectState(projectId);
      if (!serverState) {
        return {
          isConsistent: false,
          differences: ['Project not found on server'],
        };
      }

      const differences: string[] = [];
      
      // Check version
      if (clientState.projectVersion !== serverState.project.version) {
        differences.push(`Version mismatch: client=${clientState.projectVersion}, server=${serverState.project.version}`);
      }

      // Check counts
      if (clientState.trackCount !== serverState.tracks.length) {
        differences.push(`Track count mismatch: client=${clientState.trackCount}, server=${serverState.tracks.length}`);
      }

      if (clientState.regionCount !== serverState.regions.length) {
        differences.push(`Region count mismatch: client=${clientState.regionCount}, server=${serverState.regions.length}`);
      }

      if (clientState.audioFileCount !== serverState.audioFiles.length) {
        differences.push(`Audio file count mismatch: client=${clientState.audioFileCount}, server=${serverState.audioFiles.length}`);
      }

      if (clientState.markerCount !== serverState.markers.length) {
        differences.push(`Marker count mismatch: client=${clientState.markerCount}, server=${serverState.markers.length}`);
      }

      // Check checksum if provided
      if (clientState.checksum) {
        const serverChecksum = this.calculateStateChecksum(serverState);
        if (clientState.checksum !== serverChecksum) {
          differences.push(`State checksum mismatch: client=${clientState.checksum}, server=${serverChecksum}`);
        }
      }

      const isConsistent = differences.length === 0;

      loggingService.logInfo('State consistency check completed', {
        userId,
        projectId,
        isConsistent,
        differenceCount: differences.length,
      });

      return {
        isConsistent,
        differences,
        serverState: isConsistent ? undefined : {
          projectVersion: serverState.project.version,
          trackCount: serverState.tracks.length,
          regionCount: serverState.regions.length,
          audioFileCount: serverState.audioFiles.length,
          markerCount: serverState.markers.length,
          checksum: this.calculateStateChecksum(serverState),
        },
      };

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to verify state consistency'), {
        userId,
        projectId,
      });

      return {
        isConsistent: false,
        differences: ['Failed to verify state consistency'],
      };
    }
  }

  private calculateStateChecksum(state: CompleteProjectState): string {
    // Create a deterministic checksum based on key state properties
    const checksumData = {
      projectId: state.project.id,
      version: state.project.version,
      trackIds: state.tracks.map(t => t.id).sort(),
      regionIds: state.regions.map(r => r.id).sort(),
      audioFileIds: state.audioFiles.map(af => af.id).sort(),
      markerIds: state.markers.map(m => m.id).sort(),
      lastUpdated: state.project.updatedAt.getTime(),
    };

    // Simple hash function (in production, use crypto.createHash)
    const str = JSON.stringify(checksumData);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  async reconcileUserState(
    userId: string,
    projectId: string,
    clientState: any
  ): Promise<void> {
    try {
      const serverState = await this.projectStateManager.getCompleteProjectState(projectId);
      if (!serverState) return;

      // Compare states and identify differences
      const differences = this.compareStates(clientState, serverState);

      if (differences.length > 0) {
        // Send reconciliation data
        this.emit('reconcile_user_state', {
          userId,
          projectId,
          differences,
          serverState,
          timestamp: new Date(),
        });

        loggingService.logInfo('State reconciliation sent to user', {
          userId,
          projectId,
          differenceCount: differences.length,
        });
      }

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to reconcile user state'), {
        userId,
        projectId,
      });
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private prioritizeVisibleRegions(regions: RegionRecord[]): RegionRecord[] {
    // Sort regions by timeline position and importance
    return regions.sort((a, b) => {
      // Prioritize regions at the beginning of the timeline
      if (a.startTime !== b.startTime) {
        return a.startTime - b.startTime;
      }
      
      // Then by creation date (newer first)
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }

  private compareStates(clientState: any, serverState: CompleteProjectState): any[] {
    const differences: any[] = [];

    // Compare project version
    if (clientState.projectVersion !== serverState.project.version) {
      differences.push({
        type: 'project_version_mismatch',
        client: clientState.projectVersion,
        server: serverState.project.version,
      });
    }

    // Compare counts
    if (clientState.trackCount !== serverState.tracks.length) {
      differences.push({
        type: 'track_count_mismatch',
        client: clientState.trackCount,
        server: serverState.tracks.length,
      });
    }

    if (clientState.regionCount !== serverState.regions.length) {
      differences.push({
        type: 'region_count_mismatch',
        client: clientState.regionCount,
        server: serverState.regions.length,
      });
    }

    return differences;
  }

  // ============================================================================
  // State Cache System for Fast Project Loading
  // ============================================================================

  async cacheCompleteProjectState(projectId: string): Promise<void> {
    try {
      const completeState = await this.projectStateManager.getCompleteProjectState(projectId);
      if (!completeState) return;

      const cacheKey = `complete_project_state:${projectId}`;
      
      // Cache complete state with shorter TTL for large data
      this.cacheService.set(cacheKey, completeState, 120); // 2 minutes

      // Also cache critical data separately for faster access
      const criticalData = {
        project: completeState.project,
        tracks: completeState.tracks,
      };
      this.cacheService.set(`critical_data:${projectId}`, criticalData, 300); // 5 minutes

      loggingService.logInfo('Complete project state cached', {
        projectId,
        trackCount: completeState.tracks.length,
        regionCount: completeState.regions.length,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to cache complete project state'), {
        projectId,
      });
    }
  }

  async getCachedProjectState(projectId: string): Promise<CompleteProjectState | null> {
    const cacheKey = `complete_project_state:${projectId}`;
    return this.cacheService.get<CompleteProjectState>(cacheKey) || null;
  }

  async warmupProjectCache(roomId: string): Promise<void> {
    try {
      const projects = await this.projectStateManager.getProjectsByRoom(roomId);
      
      // Cache all projects in the room
      const cachePromises = projects.map(project => 
        this.cacheCompleteProjectState(project.id)
      );

      await Promise.allSettled(cachePromises);

      loggingService.logInfo('Project cache warmed up for room', {
        roomId,
        projectCount: projects.length,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to warm up project cache'), {
        roomId,
      });
    }
  }

  // ============================================================================
  // Progressive Loading for Large Projects
  // ============================================================================

  async loadProjectProgressively(
    userId: string,
    projectId: string,
    options: {
      priorityLevel: 'critical' | 'high' | 'medium' | 'low';
      timelineStart?: number;
      timelineEnd?: number;
      maxRegions?: number;
    } = { priorityLevel: 'critical' }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Step 1: Always load critical data first
      if (options.priorityLevel === 'critical') {
        const criticalData = await this.loadCriticalProjectData(projectId);
        await this.deliverCriticalData(userId, projectId, criticalData);
        
        loggingService.logInfo('Critical data loaded progressively', {
          userId,
          projectId,
          timeMs: Date.now() - startTime,
        });
        return;
      }

      // Step 2: Load visible timeline data for high priority
      if (options.priorityLevel === 'high' && options.timelineStart !== undefined && options.timelineEnd !== undefined) {
        const visibleData = await this.loadVisibleTimelineData(
          projectId,
          options.timelineStart,
          options.timelineEnd,
          options.maxRegions
        );
        
        await this.deliverVisibleTimelineData(userId, projectId, visibleData);
        
        loggingService.logInfo('Visible timeline data loaded progressively', {
          userId,
          projectId,
          regionCount: visibleData.regions.length,
          timeMs: Date.now() - startTime,
        });
        return;
      }

      // Step 3: Load remaining data for medium/low priority
      const remainingData = await this.loadRemainingProjectData(projectId);
      await this.deliverRemainingData(userId, projectId, remainingData);

      loggingService.logInfo('Remaining data loaded progressively', {
        userId,
        projectId,
        priority: options.priorityLevel,
        timeMs: Date.now() - startTime,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to load project progressively'), {
        userId,
        projectId,
        options,
      });
    }
  }

  private async loadVisibleTimelineData(
    projectId: string,
    startTime: number,
    endTime: number,
    maxRegions?: number
  ): Promise<{
    regions: RegionRecord[];
    audioFiles: AudioFileRecord[];
  }> {
    // Get all regions for the project
    const database = this.projectStateManager.getDatabase();
    const allRegions = await database.getRegionsByProject(projectId);
    
    // Filter regions that are visible in the timeline range
    const visibleRegions = allRegions.filter(region => {
      const regionEnd = region.startTime + region.duration;
      return (
        (region.startTime >= startTime && region.startTime <= endTime) ||
        (regionEnd >= startTime && regionEnd <= endTime) ||
        (region.startTime <= startTime && regionEnd >= endTime)
      );
    });

    // Sort by start time and limit if specified
    const sortedRegions = visibleRegions
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, maxRegions);

    // Get audio files for visible audio regions
    const audioFileIds = new Set(
      sortedRegions
        .filter(r => r.type === 'audio' && r.audioFileId)
        .map(r => r.audioFileId!)
    );

    const audioFiles = await Promise.all(
      Array.from(audioFileIds).map(id => 
        database.getAudioFile(id)
      )
    );

    return {
      regions: sortedRegions,
      audioFiles: audioFiles.filter(Boolean) as AudioFileRecord[],
    };
  }

  private async deliverVisibleTimelineData(
    userId: string,
    projectId: string,
    data: {
      regions: RegionRecord[];
      audioFiles: AudioFileRecord[];
    }
  ): Promise<void> {
    // Deliver visible regions first
    this.emit('deliver_visible_regions', {
      userId,
      projectId,
      regions: data.regions,
      timestamp: new Date(),
    });

    // Then deliver associated audio file metadata
    this.emit('deliver_visible_audio_metadata', {
      userId,
      projectId,
      audioFiles: data.audioFiles,
      timestamp: new Date(),
    });

    loggingService.logInfo('Visible timeline data delivered', {
      userId,
      projectId,
      regionCount: data.regions.length,
      audioFileCount: data.audioFiles.length,
    });
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  invalidateProjectCache(projectId: string): void {
    this.cacheService.del(`critical_data:${projectId}`);
    this.cacheService.del(`remaining_data:${projectId}`);
    this.cacheService.del(`complete_project_state:${projectId}`);
    
    loggingService.logInfo('Project cache invalidated for instant sync', { projectId });
  }

  async invalidateRoomCache(roomId: string): Promise<void> {
    try {
      const projects = await this.projectStateManager.getProjectsByRoom(roomId);
      
      projects.forEach(project => {
        this.invalidateProjectCache(project.id);
      });

      loggingService.logInfo('Room cache invalidated for instant sync', {
        roomId,
        projectCount: projects.length,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to invalidate room cache'), {
        roomId,
      });
    }
  }

  // ============================================================================
  // Performance Monitoring and Statistics
  // ============================================================================

  private performanceStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    totalSyncTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageProjectSize: 0,
    largestProjectSize: 0,
    syncTimesBySize: new Map<string, number[]>(), // size range -> sync times
  };

  private recordSyncStart(userId: string, projectId: string): string {
    const syncId = `${userId}-${projectId}-${Date.now()}`;
    this.performanceStats.totalSyncs++;
    return syncId;
  }

  private recordSyncSuccess(syncId: string, syncTimeMs: number, projectSize: number): void {
    this.performanceStats.successfulSyncs++;
    this.performanceStats.totalSyncTime += syncTimeMs;
    
    // Update project size stats
    this.performanceStats.averageProjectSize = 
      (this.performanceStats.averageProjectSize * (this.performanceStats.successfulSyncs - 1) + projectSize) / 
      this.performanceStats.successfulSyncs;
    
    if (projectSize > this.performanceStats.largestProjectSize) {
      this.performanceStats.largestProjectSize = projectSize;
    }

    // Track sync times by project size
    const sizeRange = this.getProjectSizeRange(projectSize);
    if (!this.performanceStats.syncTimesBySize.has(sizeRange)) {
      this.performanceStats.syncTimesBySize.set(sizeRange, []);
    }
    this.performanceStats.syncTimesBySize.get(sizeRange)!.push(syncTimeMs);

    loggingService.logInfo('Sync performance recorded', {
      syncId,
      syncTimeMs,
      projectSize,
      sizeRange,
    });
  }

  private recordSyncFailure(syncId: string, error: any): void {
    this.performanceStats.failedSyncs++;
    
    loggingService.logError(error instanceof Error ? error : new Error('Sync failure recorded'), {
      syncId,
    });
  }

  private recordCacheHit(): void {
    this.performanceStats.cacheHits++;
  }

  private recordCacheMiss(): void {
    this.performanceStats.cacheMisses++;
  }

  private getProjectSizeRange(size: number): string {
    if (size < 1000) return 'small';
    if (size < 10000) return 'medium';
    if (size < 50000) return 'large';
    return 'xlarge';
  }

  private calculateProjectSize(state: CompleteProjectState): number {
    // Calculate approximate project size based on data volume
    let size = 0;
    
    // Base project data
    size += 100;
    
    // Tracks
    size += state.tracks.length * 50;
    
    // Regions
    size += state.regions.length * 100;
    
    // MIDI notes in regions
    state.regions.forEach(region => {
      if (region.notes) {
        size += region.notes.length * 20;
      }
    });
    
    // Audio files (metadata only)
    size += state.audioFiles.length * 200;
    
    // Markers
    size += state.markers.length * 30;
    
    // Changes
    size += state.changes.length * 150;
    
    return size;
  }

  async getPerformanceStats(): Promise<{
    averageSyncTime: number;
    successfulSyncs: number;
    failedSyncs: number;
    cacheHitRate: number;
    averageProjectSize: number;
    largestProjectSize: number;
    syncTimesBySize: Record<string, { average: number; min: number; max: number; count: number }>;
    successRate: number;
  }> {
    const totalCacheRequests = this.performanceStats.cacheHits + this.performanceStats.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? this.performanceStats.cacheHits / totalCacheRequests : 0;
    
    const averageSyncTime = this.performanceStats.successfulSyncs > 0 
      ? this.performanceStats.totalSyncTime / this.performanceStats.successfulSyncs 
      : 0;

    const successRate = this.performanceStats.totalSyncs > 0
      ? this.performanceStats.successfulSyncs / this.performanceStats.totalSyncs
      : 0;

    // Calculate sync time statistics by size
    const syncTimesBySize: Record<string, { average: number; min: number; max: number; count: number }> = {};
    
    for (const [sizeRange, times] of this.performanceStats.syncTimesBySize.entries()) {
      if (times.length > 0) {
        syncTimesBySize[sizeRange] = {
          average: times.reduce((a, b) => a + b, 0) / times.length,
          min: Math.min(...times),
          max: Math.max(...times),
          count: times.length,
        };
      }
    }

    return {
      averageSyncTime,
      successfulSyncs: this.performanceStats.successfulSyncs,
      failedSyncs: this.performanceStats.failedSyncs,
      cacheHitRate,
      averageProjectSize: this.performanceStats.averageProjectSize,
      largestProjectSize: this.performanceStats.largestProjectSize,
      syncTimesBySize,
      successRate,
    };
  }

  async resetPerformanceStats(): Promise<void> {
    this.performanceStats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalSyncTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageProjectSize: 0,
      largestProjectSize: 0,
      syncTimesBySize: new Map(),
    };

    loggingService.logInfo('Performance stats reset');
  }
}