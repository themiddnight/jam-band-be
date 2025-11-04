import { EventEmitter } from 'events';
import { ProjectStateManager } from './ProjectStateManager';
import { loggingService } from './LoggingService';
import { CacheService } from './CacheService';

/**
 * Timeline state data structure
 */
export interface TimelineStateRecord {
  id: string;
  projectId: string;
  userId: string;
  timelineState: any; // Timeline state object
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lastSaved: Date;
}

/**
 * Timeline change record for tracking modifications
 */
export interface TimelineChangeRecord {
  id: string;
  projectId: string;
  userId: string;
  changeType: string;
  changeData: any;
  timestamp: Date;
  version: number;
}

/**
 * Timeline State Manager handles persistence and synchronization of timeline UI state
 */
export class TimelineStateManager extends EventEmitter {
  private static instance: TimelineStateManager;
  private projectStateManager: ProjectStateManager;
  private cacheService: CacheService;
  private readonly CACHE_TTL = 300; // 5 minutes cache TTL
  private readonly SAVE_DEBOUNCE_MS = 1000; // 1 second debounce for saves
  private saveQueue = new Map<string, NodeJS.Timeout>();

  private constructor() {
    super();
    this.projectStateManager = ProjectStateManager.getInstance();
    this.cacheService = CacheService.getInstance();
  }

  static getInstance(): TimelineStateManager {
    if (!TimelineStateManager.instance) {
      TimelineStateManager.instance = new TimelineStateManager();
    }
    return TimelineStateManager.instance;
  }

  async initialize(): Promise<void> {
    await this.projectStateManager.initialize();
    loggingService.logInfo('TimelineStateManager initialized');
  }

  // ============================================================================
  // Timeline State Operations
  // ============================================================================

  /**
   * Save timeline state for a project
   */
  async saveTimelineState(
    projectId: string,
    userId: string,
    timelineState: any,
    changes?: any[]
  ): Promise<TimelineStateRecord> {
    try {
      // Get existing timeline state
      const existingState = await this.getTimelineState(projectId);
      const version = existingState ? existingState.version + 1 : 1;

      // Create timeline state record
      const timelineStateRecord: Omit<TimelineStateRecord, 'id'> = {
        projectId,
        userId,
        timelineState,
        version,
        createdAt: existingState?.createdAt || new Date(),
        updatedAt: new Date(),
        lastSaved: new Date(),
      };

      // Save to database (simulated with in-memory storage for now)
      const savedRecord = await this.persistTimelineState(timelineStateRecord);

      // Record changes if provided
      if (changes && changes.length > 0) {
        await this.recordTimelineChanges(projectId, userId, changes, version);
      }

      // Update cache
      this.cacheTimelineState(projectId, savedRecord);

      // Emit event for real-time updates
      this.emit('timeline_state_saved', {
        projectId,
        userId,
        timelineState: savedRecord,
        changes: changes || [],
      });

      loggingService.logInfo('Timeline state saved', {
        projectId,
        userId,
        version,
        changesCount: changes?.length || 0,
      });

      return savedRecord;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save timeline state'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Get timeline state for a project
   */
  async getTimelineState(projectId: string): Promise<TimelineStateRecord | null> {
    try {
      // Try cache first
      const cacheKey = `timeline_state:${projectId}`;
      const cached = this.cacheService.get<TimelineStateRecord>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get from database (simulated)
      const timelineState = await this.loadTimelineState(projectId);
      if (timelineState) {
        this.cacheService.set(cacheKey, timelineState, this.CACHE_TTL);
      }

      return timelineState;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get timeline state'),
        { projectId }
      );
      return null;
    }
  }

  /**
   * Update timeline state with debounced saving
   */
  async updateTimelineState(
    projectId: string,
    userId: string,
    timelineState: any,
    changes?: any[]
  ): Promise<void> {
    // Clear existing timeout
    const existingTimeout = this.saveQueue.get(projectId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new save
    const timeout = setTimeout(async () => {
      try {
        await this.saveTimelineState(projectId, userId, timelineState, changes);
        this.saveQueue.delete(projectId);
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to update timeline state'),
          { projectId, userId }
        );
      }
    }, this.SAVE_DEBOUNCE_MS);

    this.saveQueue.set(projectId, timeout);
  }

  /**
   * Force immediate save of timeline state
   */
  async forceTimelineStateSave(
    projectId: string,
    userId: string,
    timelineState: any,
    changes?: any[]
  ): Promise<TimelineStateRecord> {
    // Cancel any pending save
    const existingTimeout = this.saveQueue.get(projectId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.saveQueue.delete(projectId);
    }

    // Perform immediate save
    return await this.saveTimelineState(projectId, userId, timelineState, changes);
  }

  /**
   * Delete timeline state for a project
   */
  async deleteTimelineState(projectId: string, userId: string): Promise<boolean> {
    try {
      // Delete from database (simulated)
      const success = await this.removeTimelineState(projectId);

      if (success) {
        // Clear cache
        this.invalidateTimelineStateCache(projectId);

        // Emit event
        this.emit('timeline_state_deleted', { projectId, userId });

        loggingService.logInfo('Timeline state deleted', { projectId, userId });
      }

      return success;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to delete timeline state'),
        { projectId, userId }
      );
      return false;
    }
  }

  // ============================================================================
  // Timeline Change Tracking
  // ============================================================================

  /**
   * Record timeline changes
   */
  async recordTimelineChanges(
    projectId: string,
    userId: string,
    changes: any[],
    version: number
  ): Promise<TimelineChangeRecord[]> {
    const changeRecords: TimelineChangeRecord[] = [];

    try {
      for (const change of changes) {
        const changeRecord: TimelineChangeRecord = {
          id: this.generateId(),
          projectId,
          userId,
          changeType: change.type,
          changeData: change.data,
          timestamp: new Date(change.timestamp),
          version,
        };

        // Save change record (simulated)
        await this.persistTimelineChange(changeRecord);
        changeRecords.push(changeRecord);
      }

      loggingService.logInfo('Timeline changes recorded', {
        projectId,
        userId,
        changesCount: changes.length,
        version,
      });

      return changeRecords;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to record timeline changes'),
        { projectId, userId, changesCount: changes.length }
      );
      throw error;
    }
  }

  /**
   * Get timeline changes since a specific timestamp
   */
  async getTimelineChangesSince(
    projectId: string,
    since: Date
  ): Promise<TimelineChangeRecord[]> {
    try {
      // Get changes from database (simulated)
      const changes = await this.loadTimelineChangesSince(projectId, since);
      return changes;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get timeline changes'),
        { projectId, since }
      );
      return [];
    }
  }

  /**
   * Get recent timeline changes
   */
  async getRecentTimelineChanges(
    projectId: string,
    limit: number = 50
  ): Promise<TimelineChangeRecord[]> {
    try {
      // Get recent changes from database (simulated)
      const changes = await this.loadRecentTimelineChanges(projectId, limit);
      return changes;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get recent timeline changes'),
        { projectId, limit }
      );
      return [];
    }
  }

  // ============================================================================
  // Integration with Project State
  // ============================================================================

  /**
   * Get complete project state including timeline state
   */
  async getCompleteProjectStateWithTimeline(projectId: string): Promise<any> {
    try {
      // Get project state from project state manager
      const projectState = await this.projectStateManager.getCompleteProjectState(projectId);
      
      if (!projectState) {
        return null;
      }

      // Get timeline state
      const timelineState = await this.getTimelineState(projectId);

      // Merge timeline state into project state
      return {
        ...projectState,
        timeline: timelineState?.timelineState || null,
        timelineVersion: timelineState?.version || 0,
        timelineLastSaved: timelineState?.lastSaved || null,
      };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get complete project state with timeline'),
        { projectId }
      );
      return null;
    }
  }

  /**
   * Sync timeline state with project state changes
   */
  async syncTimelineWithProjectChanges(
    projectId: string,
    userId: string,
    projectChanges: any[]
  ): Promise<void> {
    try {
      // Get current timeline state
      const currentTimelineState = await this.getTimelineState(projectId);
      
      if (!currentTimelineState) {
        return; // No timeline state to sync
      }

      // Process project changes that might affect timeline
      const timelineAffectingChanges = projectChanges.filter(change =>
        this.isTimelineAffectingChange(change)
      );

      if (timelineAffectingChanges.length === 0) {
        return; // No changes affect timeline
      }

      // Update timeline state based on project changes
      const updatedTimelineState = this.applyProjectChangesToTimeline(
        currentTimelineState.timelineState,
        timelineAffectingChanges
      );

      // Save updated timeline state
      await this.saveTimelineState(projectId, userId, updatedTimelineState);

      loggingService.logInfo('Timeline state synced with project changes', {
        projectId,
        userId,
        affectingChangesCount: timelineAffectingChanges.length,
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to sync timeline with project changes'),
        { projectId, userId }
      );
    }
  }

  /**
   * Check if a project change affects timeline state
   */
  private isTimelineAffectingChange(change: any): boolean {
    const timelineAffectingTypes = [
      'track_create',
      'track_delete',
      'track_reorder',
      'region_create',
      'region_delete',
      'project_update',
    ];

    return timelineAffectingTypes.includes(change.changeType);
  }

  /**
   * Apply project changes to timeline state
   */
  private applyProjectChangesToTimeline(timelineState: any, changes: any[]): any {
    const updatedState = { ...timelineState };

    for (const change of changes) {
      switch (change.changeType) {
        case 'track_delete':
          // Remove deleted track from timeline selection
          if (updatedState.selection?.trackIds) {
            updatedState.selection.trackIds = updatedState.selection.trackIds.filter(
              (trackId: string) => trackId !== change.data.trackId
            );
          }
          break;

        case 'region_delete':
          // Remove deleted region from timeline selection
          if (updatedState.selection?.regionIds) {
            updatedState.selection.regionIds = updatedState.selection.regionIds.filter(
              (regionId: string) => regionId !== change.data.regionId
            );
          }
          break;

        // Add more change type handlers as needed
      }
    }

    return updatedState;
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Cache timeline state
   */
  private cacheTimelineState(projectId: string, timelineState: TimelineStateRecord): void {
    const cacheKey = `timeline_state:${projectId}`;
    this.cacheService.set(cacheKey, timelineState, this.CACHE_TTL);
  }

  /**
   * Invalidate timeline state cache
   */
  private invalidateTimelineStateCache(projectId: string): void {
    const cacheKey = `timeline_state:${projectId}`;
    this.cacheService.del(cacheKey);
  }

  // ============================================================================
  // Database Operations (Simulated)
  // ============================================================================

  private timelineStates = new Map<string, TimelineStateRecord>();
  private timelineChanges = new Map<string, TimelineChangeRecord[]>();
  private transportStates = new Map<string, any>();
  private privateTransportStates = new Map<string, any>();
  private transportChangeHistory = new Map<string, any[]>();

  /**
   * Persist timeline state to database (simulated)
   */
  private async persistTimelineState(
    timelineStateData: Omit<TimelineStateRecord, 'id'>
  ): Promise<TimelineStateRecord> {
    const id = this.generateId();
    const record: TimelineStateRecord = { id, ...timelineStateData };
    
    this.timelineStates.set(timelineStateData.projectId, record);
    return record;
  }

  /**
   * Load timeline state from database (simulated)
   */
  private async loadTimelineState(projectId: string): Promise<TimelineStateRecord | null> {
    return this.timelineStates.get(projectId) || null;
  }

  /**
   * Remove timeline state from database (simulated)
   */
  private async removeTimelineState(projectId: string): Promise<boolean> {
    return this.timelineStates.delete(projectId);
  }

  /**
   * Persist timeline change to database (simulated)
   */
  private async persistTimelineChange(change: TimelineChangeRecord): Promise<void> {
    if (!this.timelineChanges.has(change.projectId)) {
      this.timelineChanges.set(change.projectId, []);
    }
    
    const changes = this.timelineChanges.get(change.projectId)!;
    changes.push(change);
    
    // Keep only last 1000 changes per project
    if (changes.length > 1000) {
      changes.shift();
    }
  }

  /**
   * Load timeline changes since timestamp (simulated)
   */
  private async loadTimelineChangesSince(
    projectId: string,
    since: Date
  ): Promise<TimelineChangeRecord[]> {
    const changes = this.timelineChanges.get(projectId) || [];
    return changes.filter(change => change.timestamp > since);
  }

  /**
   * Load recent timeline changes (simulated)
   */
  private async loadRecentTimelineChanges(
    projectId: string,
    limit: number
  ): Promise<TimelineChangeRecord[]> {
    const changes = this.timelineChanges.get(projectId) || [];
    return changes
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // ============================================================================
  // Transport State Management
  // ============================================================================

  /**
   * Get transport state for a project
   */
  async getTransportState(projectId: string): Promise<any | null> {
    try {
      const cacheKey = `transport_state:${projectId}`;
      const cached = this.cacheService.get<any>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get from simulated database
      const transportState = this.transportStates.get(projectId) || null;
      if (transportState) {
        this.cacheService.set(cacheKey, transportState, this.CACHE_TTL);
      }

      return transportState;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get transport state'),
        { projectId }
      );
      return null;
    }
  }

  /**
   * Save transport state for a project
   */
  async saveTransportState(projectId: string, transportState: any): Promise<void> {
    try {
      const stateData = {
        ...transportState,
        lastSaved: new Date().toISOString(),
        version: (transportState.version || 0) + 1,
      };
      
      // Save to simulated database
      this.transportStates.set(projectId, stateData);
      
      // Update cache
      const cacheKey = `transport_state:${projectId}`;
      this.cacheService.set(cacheKey, stateData, this.CACHE_TTL);
      
      // Emit event for real-time updates
      this.emit('transport_state_saved', {
        projectId,
        transportState: stateData,
      });
      
      loggingService.logInfo('Transport state saved', { projectId, version: stateData.version });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save transport state'),
        { projectId }
      );
      throw error;
    }
  }

  /**
   * Get private transport states for all users in a project
   */
  async getPrivateTransportStates(projectId: string): Promise<Record<string, any>> {
    try {
      const privateStates: Record<string, any> = {};
      const pattern = `${projectId}:`;
      
      for (const [key, state] of this.privateTransportStates.entries()) {
        if (key.startsWith(pattern)) {
          const userId = key.substring(pattern.length);
          privateStates[userId] = state;
        }
      }
      
      return privateStates;
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get private transport states'),
        { projectId }
      );
      return {};
    }
  }

  /**
   * Save private transport state for a user
   */
  async savePrivateTransportState(projectId: string, userId: string, privateState: any): Promise<void> {
    try {
      const stateData = {
        ...privateState,
        lastActivity: new Date().toISOString(),
      };
      
      const key = `${projectId}:${userId}`;
      this.privateTransportStates.set(key, stateData);
      
      loggingService.logInfo('Private transport state saved', { projectId, userId });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save private transport state'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Process transport changes for collaboration
   */
  async processTransportChanges(projectId: string, userId: string, changes: any[]): Promise<void> {
    try {
      // Save changes to history
      for (const change of changes) {
        await this.saveTransportChangeToHistory(projectId, userId, change);
      }
      
      // Update current transport state based on changes
      await this.applyTransportChangesToState(projectId, changes);
      
      loggingService.logInfo('Transport changes processed', { 
        projectId, 
        userId, 
        changesCount: changes.length 
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to process transport changes'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Broadcast transport changes to other users
   */
  async broadcastTransportChanges(projectId: string, userId: string, changes: any[]): Promise<void> {
    try {
      const broadcastData = {
        projectId,
        userId,
        changes,
        timestamp: new Date().toISOString(),
      };
      
      // Emit event for real-time broadcasting
      this.emit('transport_changes_broadcast', broadcastData);
      
      loggingService.logInfo('Transport changes broadcast', { 
        projectId, 
        userId, 
        changesCount: changes.length 
      });
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to broadcast transport changes'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Force synchronization of transport state
   */
  async forceSyncTransportState(projectId: string, userId: string): Promise<any> {
    try {
      const transportState = await this.getTransportState(projectId);
      
      if (!transportState) {
        throw new Error('Transport state not found');
      }
      
      // Emit sync event
      this.emit('transport_sync_forced', {
        projectId,
        userId,
        transportState,
        timestamp: new Date().toISOString(),
      });
      
      return {
        usersNotified: 1, // Simulated count
        stateVersion: transportState.version,
      };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to force sync transport state'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Handle master control requests
   */
  async requestMasterControl(projectId: string, userId: string): Promise<any> {
    try {
      const transportState = await this.getTransportState(projectId);
      
      if (!transportState) {
        throw new Error('Transport state not found');
      }
      
      // Check if there's already a master user
      if (transportState.masterUserId && transportState.masterUserId !== userId) {
        // Emit master control request event
        this.emit('master_control_requested', {
          projectId,
          requestingUserId: userId,
          currentMasterUserId: transportState.masterUserId,
          timestamp: new Date().toISOString(),
        });
        
        return {
          masterUserId: transportState.masterUserId,
          status: 'requested',
        };
      } else {
        // No current master or user is already master, grant control
        transportState.masterUserId = userId;
        await this.saveTransportState(projectId, transportState);
        
        // Emit master control change event
        this.emit('master_control_changed', {
          projectId,
          masterUserId: userId,
          timestamp: new Date().toISOString(),
        });
        
        return {
          masterUserId: userId,
          status: 'granted',
        };
      }
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to request master control'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Release master control
   */
  async releaseMasterControl(projectId: string, userId: string): Promise<any> {
    try {
      const transportState = await this.getTransportState(projectId);
      
      if (!transportState) {
        throw new Error('Transport state not found');
      }
      
      // Only allow current master to release control
      if (transportState.masterUserId !== userId) {
        throw new Error('Only current master can release control');
      }
      
      transportState.masterUserId = undefined;
      await this.saveTransportState(projectId, transportState);
      
      // Emit master control release event
      this.emit('master_control_released', {
        projectId,
        releasedByUserId: userId,
        timestamp: new Date().toISOString(),
      });
      
      return {
        masterUserId: undefined,
        status: 'released',
      };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to release master control'),
        { projectId, userId }
      );
      throw error;
    }
  }

  /**
   * Handoff master control to another user
   */
  async handoffMasterControl(projectId: string, fromUserId: string, toUserId: string): Promise<any> {
    try {
      const transportState = await this.getTransportState(projectId);
      
      if (!transportState) {
        throw new Error('Transport state not found');
      }
      
      // Only allow current master to handoff control
      if (transportState.masterUserId !== fromUserId) {
        throw new Error('Only current master can handoff control');
      }
      
      transportState.masterUserId = toUserId;
      await this.saveTransportState(projectId, transportState);
      
      // Emit master control handoff event
      this.emit('master_control_handoff', {
        projectId,
        fromUserId,
        toUserId,
        timestamp: new Date().toISOString(),
      });
      
      return {
        masterUserId: toUserId,
        status: 'handed_off',
      };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to handoff master control'),
        { projectId, fromUserId, toUserId }
      );
      throw error;
    }
  }

  /**
   * Get transport change history
   */
  async getTransportChangeHistory(projectId: string, options: {
    limit?: number;
    offset?: number;
    since?: Date;
  } = {}): Promise<any> {
    try {
      const { limit = 50, offset = 0, since } = options;
      
      const changes = this.transportChangeHistory.get(projectId) || [];
      let filteredChanges = changes;
      
      if (since) {
        filteredChanges = changes.filter(change => new Date(change.timestamp) > since);
      }
      
      const paginatedChanges = filteredChanges
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(offset, offset + limit);
      
      return {
        changes: paginatedChanges,
        total: filteredChanges.length,
        hasMore: filteredChanges.length > offset + limit,
      };
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to get transport change history'),
        { projectId }
      );
      throw error;
    }
  }

  // ============================================================================
  // Private Helper Methods for Transport State
  // ============================================================================

  /**
   * Save transport change to history
   */
  private async saveTransportChangeToHistory(projectId: string, userId: string, change: any): Promise<void> {
    try {
      const changeData = {
        ...change,
        userId,
        projectId,
        savedAt: new Date().toISOString(),
      };
      
      if (!this.transportChangeHistory.has(projectId)) {
        this.transportChangeHistory.set(projectId, []);
      }
      
      const history = this.transportChangeHistory.get(projectId)!;
      history.push(changeData);
      
      // Keep only last 1000 changes
      if (history.length > 1000) {
        history.shift();
      }
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to save transport change to history'),
        { projectId, userId }
      );
    }
  }

  /**
   * Apply transport changes to current state
   */
  private async applyTransportChangesToState(projectId: string, changes: any[]): Promise<void> {
    try {
      const transportState = await this.getTransportState(projectId);
      
      if (!transportState) {
        return;
      }
      
      // Apply changes to transport state
      for (const change of changes) {
        switch (change.type) {
          case 'transport_play':
          case 'transport_pause':
          case 'transport_stop':
            Object.assign(transportState, change.data);
            break;
          case 'transport_seek':
            transportState.position = change.data.position;
            break;
          case 'transport_loop_toggle':
            transportState.loopEnabled = change.data.loopEnabled;
            transportState.loopStart = change.data.loopStart;
            transportState.loopEnd = change.data.loopEnd;
            break;
          case 'transport_mode_change':
            transportState.mode = change.data.mode;
            break;
          case 'transport_master_change':
            transportState.masterUserId = change.data.masterUserId;
            break;
        }
      }
      
      // Save updated state
      await this.saveTransportState(projectId, transportState);
    } catch (error) {
      loggingService.logError(
        error instanceof Error ? error : new Error('Failed to apply transport changes to state'),
        { projectId }
      );
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `timeline_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    timelineStates: number;
    totalChanges: number;
    transportStates: number;
    privateTransportStates: number;
    transportChanges: number;
    cacheHitRate: number;
  }> {
    const totalChanges = Array.from(this.timelineChanges.values())
      .reduce((sum, changes) => sum + changes.length, 0);

    const totalTransportChanges = Array.from(this.transportChangeHistory.values())
      .reduce((sum, changes) => sum + changes.length, 0);

    return {
      timelineStates: this.timelineStates.size,
      totalChanges,
      transportStates: this.transportStates.size,
      privateTransportStates: this.privateTransportStates.size,
      transportChanges: totalTransportChanges,
      cacheHitRate: 0.85, // Simulated cache hit rate
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Clear any pending saves
    for (const timeout of this.saveQueue.values()) {
      clearTimeout(timeout);
    }
    this.saveQueue.clear();

    const stats = await this.getStats();
    loggingService.logInfo('TimelineStateManager cleanup completed', { stats });
  }
}