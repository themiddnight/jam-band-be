import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ProjectRecord,
  TrackRecord,
  RegionRecord,
  AudioFileRecord,
  MarkerRecord,
  ProjectChangeRecord,
  CompleteProjectState,
} from '../types/daw';
import { loggingService } from './LoggingService';

/**
 * Simple file-based database for DAW project storage
 * Uses JSON files for persistence with in-memory caching
 */
export class ProjectDatabase {
  private static instance: ProjectDatabase;
  private dataPath: string;
  private initialized = false;

  // In-memory storage
  private projects = new Map<string, ProjectRecord>();
  private tracks = new Map<string, TrackRecord>();
  private regions = new Map<string, RegionRecord>();
  private audioFiles = new Map<string, AudioFileRecord>();
  private markers = new Map<string, MarkerRecord>();
  private changes = new Map<string, ProjectChangeRecord>();

  // Indexes for efficient queries
  private projectsByRoom = new Map<string, Set<string>>();
  private tracksByProject = new Map<string, Set<string>>();
  private regionsByProject = new Map<string, Set<string>>();
  private regionsByTrack = new Map<string, Set<string>>();
  private audioFilesByProject = new Map<string, Set<string>>();
  private markersByProject = new Map<string, Set<string>>();
  private changesByProject = new Map<string, Set<string>>();

  private constructor(dataPath: string = './data/daw') {
    this.dataPath = dataPath;
  }

  static getInstance(dataPath?: string): ProjectDatabase {
    if (!ProjectDatabase.instance) {
      ProjectDatabase.instance = new ProjectDatabase(dataPath);
    }
    return ProjectDatabase.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataPath, { recursive: true });

      // Load existing data
      await this.loadData();

      this.initialized = true;
      loggingService.logInfo('ProjectDatabase initialized', { dataPath: this.dataPath });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to initialize ProjectDatabase'));
      throw error;
    }
  }

  private async loadData(): Promise<void> {
    try {
      // Load projects
      const projectsFile = join(this.dataPath, 'projects.json');
      try {
        const projectsData = await fs.readFile(projectsFile, 'utf-8');
        const projects: ProjectRecord[] = JSON.parse(projectsData);
        projects.forEach(project => {
          // Convert date strings back to Date objects
          project.createdAt = new Date(project.createdAt);
          project.updatedAt = new Date(project.updatedAt);
          project.lastSaved = new Date(project.lastSaved);
          
          this.projects.set(project.id, project);
          this.addToIndex(this.projectsByRoom, project.roomId, project.id);
        });
      } catch {
        // File doesn't exist yet, that's okay
      }

      // Load tracks
      const tracksFile = join(this.dataPath, 'tracks.json');
      try {
        const tracksData = await fs.readFile(tracksFile, 'utf-8');
        const tracks: TrackRecord[] = JSON.parse(tracksData);
        tracks.forEach(track => {
          track.createdAt = new Date(track.createdAt);
          track.updatedAt = new Date(track.updatedAt);
          
          this.tracks.set(track.id, track);
          this.addToIndex(this.tracksByProject, track.projectId, track.id);
        });
      } catch {
        // File doesn't exist yet
      }

      // Load regions
      const regionsFile = join(this.dataPath, 'regions.json');
      try {
        const regionsData = await fs.readFile(regionsFile, 'utf-8');
        const regions: RegionRecord[] = JSON.parse(regionsData);
        regions.forEach(region => {
          region.createdAt = new Date(region.createdAt);
          region.updatedAt = new Date(region.updatedAt);
          
          this.regions.set(region.id, region);
          this.addToIndex(this.regionsByProject, region.projectId, region.id);
          this.addToIndex(this.regionsByTrack, region.trackId, region.id);
        });
      } catch {
        // File doesn't exist yet
      }

      // Load audio files
      const audioFilesFile = join(this.dataPath, 'audioFiles.json');
      try {
        const audioFilesData = await fs.readFile(audioFilesFile, 'utf-8');
        const audioFiles: AudioFileRecord[] = JSON.parse(audioFilesData);
        audioFiles.forEach(audioFile => {
          audioFile.uploadedAt = new Date(audioFile.uploadedAt);
          
          this.audioFiles.set(audioFile.id, audioFile);
          this.addToIndex(this.audioFilesByProject, audioFile.projectId, audioFile.id);
        });
      } catch {
        // File doesn't exist yet
      }

      // Load markers
      const markersFile = join(this.dataPath, 'markers.json');
      try {
        const markersData = await fs.readFile(markersFile, 'utf-8');
        const markers: MarkerRecord[] = JSON.parse(markersData);
        markers.forEach(marker => {
          marker.createdAt = new Date(marker.createdAt);
          marker.updatedAt = new Date(marker.updatedAt);
          
          this.markers.set(marker.id, marker);
          this.addToIndex(this.markersByProject, marker.projectId, marker.id);
        });
      } catch {
        // File doesn't exist yet
      }

      // Load changes
      const changesFile = join(this.dataPath, 'changes.json');
      try {
        const changesData = await fs.readFile(changesFile, 'utf-8');
        const changes: ProjectChangeRecord[] = JSON.parse(changesData);
        changes.forEach(change => {
          change.timestamp = new Date(change.timestamp);
          
          this.changes.set(change.id, change);
          this.addToIndex(this.changesByProject, change.projectId, change.id);
        });
      } catch {
        // File doesn't exist yet
      }

      loggingService.logInfo('ProjectDatabase data loaded', {
        projects: this.projects.size,
        tracks: this.tracks.size,
        regions: this.regions.size,
        audioFiles: this.audioFiles.size,
        markers: this.markers.size,
        changes: this.changes.size,
      });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to load ProjectDatabase data'));
      throw error;
    }
  }

  private async saveData(): Promise<void> {
    try {
      // Save projects
      const projectsArray = Array.from(this.projects.values());
      await fs.writeFile(
        join(this.dataPath, 'projects.json'),
        JSON.stringify(projectsArray, null, 2)
      );

      // Save tracks
      const tracksArray = Array.from(this.tracks.values());
      await fs.writeFile(
        join(this.dataPath, 'tracks.json'),
        JSON.stringify(tracksArray, null, 2)
      );

      // Save regions
      const regionsArray = Array.from(this.regions.values());
      await fs.writeFile(
        join(this.dataPath, 'regions.json'),
        JSON.stringify(regionsArray, null, 2)
      );

      // Save audio files
      const audioFilesArray = Array.from(this.audioFiles.values());
      await fs.writeFile(
        join(this.dataPath, 'audioFiles.json'),
        JSON.stringify(audioFilesArray, null, 2)
      );

      // Save markers
      const markersArray = Array.from(this.markers.values());
      await fs.writeFile(
        join(this.dataPath, 'markers.json'),
        JSON.stringify(markersArray, null, 2)
      );

      // Save changes
      const changesArray = Array.from(this.changes.values());
      await fs.writeFile(
        join(this.dataPath, 'changes.json'),
        JSON.stringify(changesArray, null, 2)
      );
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to save ProjectDatabase data'));
      throw error;
    }
  }

  // ============================================================================
  // Index Management
  // ============================================================================

  private addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    if (!index.has(key)) {
      index.set(key, new Set());
    }
    index.get(key)!.add(value);
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    const set = index.get(key);
    if (set) {
      set.delete(value);
      if (set.size === 0) {
        index.delete(key);
      }
    }
  }

  // ============================================================================
  // Project Operations
  // ============================================================================

  async createProject(project: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastSaved' | 'version'>): Promise<ProjectRecord> {
    const now = new Date();
    const newProject: ProjectRecord = {
      ...project,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
      lastSaved: now,
      version: 1,
    };

    this.projects.set(newProject.id, newProject);
    this.addToIndex(this.projectsByRoom, newProject.roomId, newProject.id);

    await this.saveData();
    
    loggingService.logInfo('Project created', { projectId: newProject.id, roomId: newProject.roomId });
    return newProject;
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    return this.projects.get(projectId) || null;
  }

  async getProjectsByRoom(roomId: string): Promise<ProjectRecord[]> {
    const projectIds = this.projectsByRoom.get(roomId) || new Set();
    return Array.from(projectIds).map(id => this.projects.get(id)!).filter(Boolean);
  }

  async updateProject(projectId: string, updates: Partial<ProjectRecord>): Promise<ProjectRecord | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const updatedProject: ProjectRecord = {
      ...project,
      ...updates,
      updatedAt: new Date(),
      version: project.version + 1,
    };

    this.projects.set(projectId, updatedProject);
    await this.saveData();

    loggingService.logInfo('Project updated', { projectId });
    return updatedProject;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // Remove from indexes
    this.removeFromIndex(this.projectsByRoom, project.roomId, projectId);

    // Delete related data
    const trackIds = this.tracksByProject.get(projectId) || new Set();
    for (const trackId of trackIds) {
      await this.deleteTrack(trackId);
    }

    const audioFileIds = this.audioFilesByProject.get(projectId) || new Set();
    for (const audioFileId of audioFileIds) {
      await this.deleteAudioFile(audioFileId);
    }

    const markerIds = this.markersByProject.get(projectId) || new Set();
    for (const markerId of markerIds) {
      await this.deleteMarker(markerId);
    }

    // Delete project
    this.projects.delete(projectId);
    await this.saveData();

    loggingService.logInfo('Project deleted', { projectId });
    return true;
  }

  // ============================================================================
  // Track Operations
  // ============================================================================

  async createTrack(track: Omit<TrackRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TrackRecord> {
    const now = new Date();
    const newTrack: TrackRecord = {
      ...track,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };

    this.tracks.set(newTrack.id, newTrack);
    this.addToIndex(this.tracksByProject, newTrack.projectId, newTrack.id);

    await this.saveData();
    
    loggingService.logInfo('Track created', { trackId: newTrack.id, projectId: newTrack.projectId });
    return newTrack;
  }

  async getTrack(trackId: string): Promise<TrackRecord | null> {
    return this.tracks.get(trackId) || null;
  }

  async getTracksByProject(projectId: string): Promise<TrackRecord[]> {
    const trackIds = this.tracksByProject.get(projectId) || new Set();
    return Array.from(trackIds)
      .map(id => this.tracks.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }

  async updateTrack(trackId: string, updates: Partial<TrackRecord>): Promise<TrackRecord | null> {
    const track = this.tracks.get(trackId);
    if (!track) return null;

    const updatedTrack: TrackRecord = {
      ...track,
      ...updates,
      updatedAt: new Date(),
    };

    this.tracks.set(trackId, updatedTrack);
    await this.saveData();

    return updatedTrack;
  }

  async deleteTrack(trackId: string): Promise<boolean> {
    const track = this.tracks.get(trackId);
    if (!track) return false;

    // Remove from indexes
    this.removeFromIndex(this.tracksByProject, track.projectId, trackId);

    // Delete related regions
    const regionIds = this.regionsByTrack.get(trackId) || new Set();
    for (const regionId of regionIds) {
      await this.deleteRegion(regionId);
    }

    // Delete track
    this.tracks.delete(trackId);
    await this.saveData();

    return true;
  }

  // ============================================================================
  // Region Operations
  // ============================================================================

  async createRegion(region: Omit<RegionRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<RegionRecord> {
    const now = new Date();
    const newRegion: RegionRecord = {
      ...region,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };

    this.regions.set(newRegion.id, newRegion);
    this.addToIndex(this.regionsByProject, newRegion.projectId, newRegion.id);
    this.addToIndex(this.regionsByTrack, newRegion.trackId, newRegion.id);

    await this.saveData();
    
    loggingService.logInfo('Region created', { regionId: newRegion.id, trackId: newRegion.trackId });
    return newRegion;
  }

  async getRegion(regionId: string): Promise<RegionRecord | null> {
    return this.regions.get(regionId) || null;
  }

  async getRegionsByProject(projectId: string): Promise<RegionRecord[]> {
    const regionIds = this.regionsByProject.get(projectId) || new Set();
    return Array.from(regionIds).map(id => this.regions.get(id)!).filter(Boolean);
  }

  async getRegionsByTrack(trackId: string): Promise<RegionRecord[]> {
    const regionIds = this.regionsByTrack.get(trackId) || new Set();
    return Array.from(regionIds)
      .map(id => this.regions.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.startTime - b.startTime);
  }

  async updateRegion(regionId: string, updates: Partial<RegionRecord>): Promise<RegionRecord | null> {
    const region = this.regions.get(regionId);
    if (!region) return null;

    const updatedRegion: RegionRecord = {
      ...region,
      ...updates,
      updatedAt: new Date(),
    };

    this.regions.set(regionId, updatedRegion);
    await this.saveData();

    return updatedRegion;
  }

  async deleteRegion(regionId: string): Promise<boolean> {
    const region = this.regions.get(regionId);
    if (!region) return false;

    // Remove from indexes
    this.removeFromIndex(this.regionsByProject, region.projectId, regionId);
    this.removeFromIndex(this.regionsByTrack, region.trackId, regionId);

    // Delete region
    this.regions.delete(regionId);
    await this.saveData();

    return true;
  }

  // ============================================================================
  // Audio File Operations
  // ============================================================================

  async createAudioFile(audioFile: Omit<AudioFileRecord, 'id' | 'uploadedAt'>): Promise<AudioFileRecord> {
    const newAudioFile: AudioFileRecord = {
      ...audioFile,
      id: uuidv4(),
      uploadedAt: new Date(),
    };

    this.audioFiles.set(newAudioFile.id, newAudioFile);
    this.addToIndex(this.audioFilesByProject, newAudioFile.projectId, newAudioFile.id);

    await this.saveData();
    
    loggingService.logInfo('Audio file created', { audioFileId: newAudioFile.id, projectId: newAudioFile.projectId });
    return newAudioFile;
  }

  async getAudioFile(audioFileId: string): Promise<AudioFileRecord | null> {
    return this.audioFiles.get(audioFileId) || null;
  }

  async getAudioFilesByProject(projectId: string): Promise<AudioFileRecord[]> {
    const audioFileIds = this.audioFilesByProject.get(projectId) || new Set();
    return Array.from(audioFileIds).map(id => this.audioFiles.get(id)!).filter(Boolean);
  }

  async updateAudioFile(audioFileId: string, updates: Partial<AudioFileRecord>): Promise<AudioFileRecord | null> {
    const audioFile = this.audioFiles.get(audioFileId);
    if (!audioFile) return null;

    const updatedAudioFile: AudioFileRecord = {
      ...audioFile,
      ...updates,
    };

    this.audioFiles.set(audioFileId, updatedAudioFile);
    await this.saveData();

    return updatedAudioFile;
  }

  async deleteAudioFile(audioFileId: string): Promise<boolean> {
    const audioFile = this.audioFiles.get(audioFileId);
    if (!audioFile) return false;

    // Remove from indexes
    this.removeFromIndex(this.audioFilesByProject, audioFile.projectId, audioFileId);

    // Delete audio file
    this.audioFiles.delete(audioFileId);
    await this.saveData();

    return true;
  }

  // ============================================================================
  // Marker Operations
  // ============================================================================

  async createMarker(marker: Omit<MarkerRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<MarkerRecord> {
    const now = new Date();
    const newMarker: MarkerRecord = {
      ...marker,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };

    this.markers.set(newMarker.id, newMarker);
    this.addToIndex(this.markersByProject, newMarker.projectId, newMarker.id);

    await this.saveData();
    
    return newMarker;
  }

  async getMarkersByProject(projectId: string): Promise<MarkerRecord[]> {
    const markerIds = this.markersByProject.get(projectId) || new Set();
    return Array.from(markerIds)
      .map(id => this.markers.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.position - b.position);
  }

  async deleteMarker(markerId: string): Promise<boolean> {
    const marker = this.markers.get(markerId);
    if (!marker) return false;

    // Remove from indexes
    this.removeFromIndex(this.markersByProject, marker.projectId, markerId);

    // Delete marker
    this.markers.delete(markerId);
    await this.saveData();

    return true;
  }

  // ============================================================================
  // Change Tracking Operations
  // ============================================================================

  async recordChange(change: Omit<ProjectChangeRecord, 'id' | 'timestamp'>): Promise<ProjectChangeRecord> {
    const newChange: ProjectChangeRecord = {
      ...change,
      id: uuidv4(),
      timestamp: new Date(),
    };

    this.changes.set(newChange.id, newChange);
    this.addToIndex(this.changesByProject, newChange.projectId, newChange.id);

    await this.saveData();
    
    return newChange;
  }

  async getChangesByProject(projectId: string, limit?: number): Promise<ProjectChangeRecord[]> {
    const changeIds = this.changesByProject.get(projectId) || new Set();
    const changes = Array.from(changeIds)
      .map(id => this.changes.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return limit ? changes.slice(0, limit) : changes;
  }

  async getChangesSince(projectId: string, timestamp: Date): Promise<ProjectChangeRecord[]> {
    const changeIds = this.changesByProject.get(projectId) || new Set();
    return Array.from(changeIds)
      .map(id => this.changes.get(id)!)
      .filter(Boolean)
      .filter(change => change.timestamp > timestamp)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // ============================================================================
  // Complete State Operations
  // ============================================================================

  async getCompleteProjectState(projectId: string): Promise<CompleteProjectState | null> {
    const project = await this.getProject(projectId);
    if (!project) return null;

    const [tracks, regions, audioFiles, markers, changes] = await Promise.all([
      this.getTracksByProject(projectId),
      this.getRegionsByProject(projectId),
      this.getAudioFilesByProject(projectId),
      this.getMarkersByProject(projectId),
      this.getChangesByProject(projectId, 100), // Last 100 changes
    ]);

    return {
      project,
      tracks,
      regions,
      audioFiles,
      markers,
      changes,
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // Cleanup Operations
  // ============================================================================

  async cleanupOldChanges(projectId: string, keepDays: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
    const changeIds = this.changesByProject.get(projectId) || new Set();
    
    let deletedCount = 0;
    for (const changeId of changeIds) {
      const change = this.changes.get(changeId);
      if (change && change.timestamp < cutoffDate) {
        this.changes.delete(changeId);
        this.removeFromIndex(this.changesByProject, projectId, changeId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      await this.saveData();
      loggingService.logInfo('Cleaned up old changes', { projectId, deletedCount });
    }

    return deletedCount;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  async getStats(): Promise<{
    projects: number;
    tracks: number;
    regions: number;
    audioFiles: number;
    markers: number;
    changes: number;
  }> {
    return {
      projects: this.projects.size,
      tracks: this.tracks.size,
      regions: this.regions.size,
      audioFiles: this.audioFiles.size,
      markers: this.markers.size,
      changes: this.changes.size,
    };
  }
}