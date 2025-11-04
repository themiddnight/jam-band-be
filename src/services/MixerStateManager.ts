import { loggingService } from './LoggingService';

/**
 * Mixer state data structure
 */
export interface MixerStateData {
  tracks: Array<{
    id: string;
    level: number;
    muted: boolean;
    soloed: boolean;
    pan: number;
    effectsEnabled: boolean;
    effects: Array<{
      id: string;
      type: string;
      name: string;
      bypassed: boolean;
      parameters: Array<{
        id: string;
        name: string;
        value: number;
      }>;
      order: number;
    }>;
  }>;
  masterLevel: number;
  masterMuted: boolean;
  lastUpdated: Date;
}

/**
 * Stored mixer state with metadata
 */
export interface StoredMixerState {
  id: string;
  projectId: string;
  mixerState: MixerStateData;
  version: number;
  lastSaved: Date;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * Mixer change data
 */
export interface MixerChange {
  id: string;
  projectId: string;
  userId: string;
  changeType: string;
  data: any;
  trackId?: string;
  effectId?: string;
  timestamp: Date;
}

/**
 * Effects sync status
 */
export interface EffectsSyncStatus {
  status: 'synced' | 'syncing' | 'error';
  pendingEffects: number;
  lastSyncTime: Date | null;
  errorMessage?: string;
}

/**
 * Effects sync result
 */
export interface EffectsSyncResult {
  syncedEffects: number;
  failedEffects: number;
  errors: string[];
}

/**
 * Mixer state manager statistics
 */
export interface MixerStateStats {
  totalProjects: number;
  totalTracks: number;
  totalEffects: number;
  totalChanges: number;
  averageTracksPerProject: number;
  averageEffectsPerTrack: number;
  lastActivity: Date | null;
}

/**
 * MixerStateManager - Manages mixer state persistence and synchronization
 */
export class MixerStateManager {
  private static instance: MixerStateManager | null = null;
  private mixerStates = new Map<string, StoredMixerState>();
  private mixerChanges = new Map<string, MixerChange[]>();
  private effectsSyncStatus = new Map<string, EffectsSyncStatus>();
  private isInitialized = false;

  private constructor() {
    this.initialize();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MixerStateManager {
    if (!MixerStateManager.instance) {
      MixerStateManager.instance = new MixerStateManager();
    }
    return MixerStateManager.instance;
  }

  /**
   * Initialize the mixer state manager
   */
  private async initialize(): Promise<void> {
    try {
      // In a real implementation, this would connect to a database
      // For now, we'll use in-memory storage
      
      loggingService.logInfo('MixerStateManager initialized');
      this.isInitialized = true;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to initialize MixerStateManager'),
        {}
      );
      throw error;
    }
  }

  /**
   * Ensure manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('MixerStateManager not initialized');
    }
  }

  // ============================================================================
  // Mixer State Operations
  // ============================================================================

  /**
   * Get mixer state for a project
   */
  public async getMixerState(projectId: string): Promise<StoredMixerState | null> {
    this.ensureInitialized();

    try {
      const mixerState = this.mixerStates.get(projectId);
      
      if (mixerState) {
        loggingService.logInfo('Mixer state retrieved', {
          projectId,
          version: mixerState.version,
          tracksCount: mixerState.mixerState.tracks.length,
        });
      }

      return mixerState || null;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get mixer state'),
        { projectId }
      );
      throw error;
    }
  }

  /**
   * Save mixer state for a project
   */
  public async saveMixerState(
    projectId: string,
    userId: string,
    mixerState: MixerStateData,
    changes?: MixerChange[]
  ): Promise<StoredMixerState> {
    this.ensureInitialized();

    try {
      const now = new Date();
      const existingState = this.mixerStates.get(projectId);
      const newVersion = existingState ? existingState.version + 1 : 1;

      const storedState: StoredMixerState = {
        id: existingState?.id || this.generateId(),
        projectId,
        mixerState: {
          ...mixerState,
          lastUpdated: now,
        },
        version: newVersion,
        lastSaved: now,
        updatedAt: now,
        updatedBy: userId,
      };

      // Store the state
      this.mixerStates.set(projectId, storedState);

      // Store changes if provided
      if (changes && changes.length > 0) {
        const existingChanges = this.mixerChanges.get(projectId) || [];
        const updatedChanges = [...existingChanges, ...changes];
        
        // Keep only the last 1000 changes per project
        if (updatedChanges.length > 1000) {
          updatedChanges.splice(0, updatedChanges.length - 1000);
        }
        
        this.mixerChanges.set(projectId, updatedChanges);
      }

      loggingService.logInfo('Mixer state saved', {
        projectId,
        userId,
        version: newVersion,
        tracksCount: mixerState.tracks.length,
        changesCount: changes?.length || 0,
      });

      return storedState;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save mixer state'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Force save mixer state (immediate, no debouncing)
   */
  public async forceMixerStateSave(
    projectId: string,
    userId: string,
    mixerState: MixerStateData,
    changes?: MixerChange[]
  ): Promise<StoredMixerState> {
    // For now, this is the same as regular save
    // In a real implementation, this might bypass caching or use different persistence logic
    return this.saveMixerState(projectId, userId, mixerState, changes);
  }

  /**
   * Delete mixer state for a project
   */
  public async deleteMixerState(projectId: string, userId: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      const existed = this.mixerStates.has(projectId);
      
      if (existed) {
        this.mixerStates.delete(projectId);
        this.mixerChanges.delete(projectId);
        this.effectsSyncStatus.delete(projectId);

        loggingService.logInfo('Mixer state deleted', {
          projectId,
          userId,
        });
      }

      return existed;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete mixer state'),
        { projectId, userId }
      );
      throw error;
    }
  }

  // ============================================================================
  // Change Tracking
  // ============================================================================

  /**
   * Get mixer changes since a specific timestamp
   */
  public async getMixerChangesSince(
    projectId: string,
    since: Date,
    trackId?: string,
    effectId?: string
  ): Promise<MixerChange[]> {
    this.ensureInitialized();

    try {
      const allChanges = this.mixerChanges.get(projectId) || [];
      
      let filteredChanges = allChanges.filter(change => 
        change.timestamp > since
      );

      // Filter by track ID if provided
      if (trackId) {
        filteredChanges = filteredChanges.filter(change => 
          change.trackId === trackId
        );
      }

      // Filter by effect ID if provided
      if (effectId) {
        filteredChanges = filteredChanges.filter(change => 
          change.effectId === effectId
        );
      }

      return filteredChanges;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get mixer changes since timestamp'),
        { projectId, since: since.toISOString() }
      );
      throw error;
    }
  }

  /**
   * Get recent mixer changes
   */
  public async getRecentMixerChanges(
    projectId: string,
    limit: number = 50,
    trackId?: string,
    effectId?: string
  ): Promise<MixerChange[]> {
    this.ensureInitialized();

    try {
      const allChanges = this.mixerChanges.get(projectId) || [];
      
      let filteredChanges = [...allChanges];

      // Filter by track ID if provided
      if (trackId) {
        filteredChanges = filteredChanges.filter(change => 
          change.trackId === trackId
        );
      }

      // Filter by effect ID if provided
      if (effectId) {
        filteredChanges = filteredChanges.filter(change => 
          change.effectId === effectId
        );
      }

      // Sort by timestamp (newest first) and limit
      return filteredChanges
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get recent mixer changes'),
        { projectId, limit }
      );
      throw error;
    }
  }

  // ============================================================================
  // Effects Synchronization
  // ============================================================================

  /**
   * Get effects synchronization status
   */
  public async getEffectsSyncStatus(projectId: string): Promise<EffectsSyncStatus> {
    this.ensureInitialized();

    try {
      const status = this.effectsSyncStatus.get(projectId) || {
        status: 'synced' as const,
        pendingEffects: 0,
        lastSyncTime: null,
      };

      return status;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get effects sync status'),
        { projectId }
      );
      throw error;
    }
  }

  /**
   * Force effects synchronization
   */
  public async forceEffectsSync(
    projectId: string,
    userId: string,
    trackId?: string,
    effectId?: string
  ): Promise<EffectsSyncResult> {
    this.ensureInitialized();

    try {
      // Update sync status
      this.effectsSyncStatus.set(projectId, {
        status: 'syncing',
        pendingEffects: 0,
        lastSyncTime: new Date(),
      });

      // In a real implementation, this would:
      // 1. Identify effects that need synchronization
      // 2. Apply effect parameter changes across all connected users
      // 3. Resolve any conflicts in effect states
      // 4. Update the sync status

      // For now, simulate successful sync
      const result: EffectsSyncResult = {
        syncedEffects: 0,
        failedEffects: 0,
        errors: [],
      };

      // Count effects to sync
      const mixerState = this.mixerStates.get(projectId);
      if (mixerState) {
        for (const track of mixerState.mixerState.tracks) {
          if (!trackId || track.id === trackId) {
            for (const effect of track.effects) {
              if (!effectId || effect.id === effectId) {
                result.syncedEffects++;
              }
            }
          }
        }
      }

      // Update sync status to completed
      this.effectsSyncStatus.set(projectId, {
        status: 'synced',
        pendingEffects: 0,
        lastSyncTime: new Date(),
      });

      loggingService.logInfo('Effects sync completed', {
        projectId,
        userId,
        trackId: trackId || null,
        effectId: effectId || null,
        syncedEffects: result.syncedEffects,
      });

      return result;
    } catch (error) {
      // Update sync status to error
      this.effectsSyncStatus.set(projectId, {
        status: 'error',
        pendingEffects: 0,
        lastSyncTime: new Date(),
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to force effects sync'),
        { projectId, userId }
      );
      throw error;
    }
  }

  // ============================================================================
  // Statistics and Monitoring
  // ============================================================================

  /**
   * Get mixer state manager statistics
   */
  public async getStats(): Promise<MixerStateStats> {
    this.ensureInitialized();

    try {
      const totalProjects = this.mixerStates.size;
      let totalTracks = 0;
      let totalEffects = 0;
      let lastActivity: Date | null = null;

      // Calculate track and effect counts
      for (const [, state] of this.mixerStates) {
        totalTracks += state.mixerState.tracks.length;
        
        for (const track of state.mixerState.tracks) {
          totalEffects += track.effects.length;
        }

        if (!lastActivity || state.updatedAt > lastActivity) {
          lastActivity = state.updatedAt;
        }
      }

      // Calculate total changes
      let totalChanges = 0;
      for (const [, changes] of this.mixerChanges) {
        totalChanges += changes.length;
      }

      const stats: MixerStateStats = {
        totalProjects,
        totalTracks,
        totalEffects,
        totalChanges,
        averageTracksPerProject: totalProjects > 0 ? totalTracks / totalProjects : 0,
        averageEffectsPerTrack: totalTracks > 0 ? totalEffects / totalTracks : 0,
        lastActivity,
      };

      return stats;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get mixer state stats'),
        {}
      );
      throw error;
    }
  }

  // ============================================================================
  // Integration with Project State
  // ============================================================================

  /**
   * Get complete project state including mixer state
   */
  public async getCompleteProjectStateWithMixer(projectId: string): Promise<any> {
    this.ensureInitialized();

    try {
      const mixerState = await this.getMixerState(projectId);
      
      // In a real implementation, this would integrate with other state managers
      // to provide a complete project state
      return {
        projectId,
        mixer: mixerState?.mixerState || null,
        mixerVersion: mixerState?.version || 0,
        lastUpdated: mixerState?.updatedAt || null,
      };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get complete project state with mixer'),
        { projectId }
      );
      throw error;
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `mixer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate mixer state data
   */
  public validateMixerState(mixerState: any): boolean {
    try {
      if (!mixerState || typeof mixerState !== 'object') {
        return false;
      }

      // Check required properties
      if (!Array.isArray(mixerState.tracks) ||
          typeof mixerState.masterLevel !== 'number' ||
          typeof mixerState.masterMuted !== 'boolean') {
        return false;
      }

      // Validate each track
      for (const track of mixerState.tracks) {
        if (!this.validateTrackState(track)) {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate track state
   */
  private validateTrackState(track: any): boolean {
    if (!track || typeof track !== 'object') {
      return false;
    }

    const requiredProps = ['id', 'level', 'muted', 'soloed', 'pan', 'effectsEnabled', 'effects'];
    for (const prop of requiredProps) {
      if (!(prop in track)) {
        return false;
      }
    }

    return (
      typeof track.id === 'string' &&
      typeof track.level === 'number' &&
      typeof track.muted === 'boolean' &&
      typeof track.soloed === 'boolean' &&
      typeof track.pan === 'number' &&
      typeof track.effectsEnabled === 'boolean' &&
      Array.isArray(track.effects)
    );
  }

  /**
   * Clean up old data (maintenance)
   */
  public async cleanup(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    this.ensureInitialized();

    try {
      const cutoffDate = new Date(Date.now() - maxAge);
      let cleanedProjects = 0;
      let cleanedChanges = 0;

      // Clean up old mixer states
      for (const [projectId, state] of this.mixerStates) {
        if (state.updatedAt < cutoffDate) {
          this.mixerStates.delete(projectId);
          this.mixerChanges.delete(projectId);
          this.effectsSyncStatus.delete(projectId);
          cleanedProjects++;
        }
      }

      // Clean up old changes within active projects
      for (const [projectId, changes] of this.mixerChanges) {
        const filteredChanges = changes.filter(change => change.timestamp >= cutoffDate);
        if (filteredChanges.length !== changes.length) {
          cleanedChanges += changes.length - filteredChanges.length;
          this.mixerChanges.set(projectId, filteredChanges);
        }
      }

      loggingService.logInfo('Mixer state cleanup completed', {
        cleanedProjects,
        cleanedChanges,
        maxAge,
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to cleanup mixer state data'),
        { maxAge }
      );
      throw error;
    }
  }
}