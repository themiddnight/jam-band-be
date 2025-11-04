import { EventEmitter } from 'events';
import type {
  ProjectChangeRecord,
  ProjectChangeType,
  CompleteProjectState,
} from '../types/daw';
import { ProjectStateManager } from './ProjectStateManager';
import { loggingService } from './LoggingService';
import { CacheService } from './CacheService';

/**
 * Real-time change persistence service
 * Handles automatic saving, change streaming, and conflict resolution
 */
export class RealTimeChangeService extends EventEmitter {
  private static instance: RealTimeChangeService;
  private projectStateManager: ProjectStateManager;
  private cacheService: CacheService;
  
  // Change streaming and persistence
  private changeQueue = new Map<string, ChangeQueueItem[]>();
  private saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly SAVE_DEBOUNCE_MS = 1000; // 1 second as required
  private readonly MAX_QUEUE_SIZE = 100;
  
  // Conflict resolution
  private lockManager = new Map<string, ProjectLock>();
  private readonly LOCK_TIMEOUT_MS = 5000; // 5 seconds
  
  // Change history for rollback
  private changeHistory = new Map<string, ProjectChangeRecord[]>();
  private readonly MAX_HISTORY_SIZE = 1000;

  private constructor() {
    super();
    this.projectStateManager = ProjectStateManager.getInstance();
    this.cacheService = CacheService.getInstance();
    
    // Listen to project state manager events
    this.setupEventListeners();
  }

  static getInstance(): RealTimeChangeService {
    if (!RealTimeChangeService.instance) {
      RealTimeChangeService.instance = new RealTimeChangeService();
    }
    return RealTimeChangeService.instance;
  }

  async initialize(): Promise<void> {
    loggingService.logInfo('RealTimeChangeService initialized');
  }

  // ============================================================================
  // Change Streaming and Persistence
  // ============================================================================

  /**
   * Queue a change for real-time persistence
   */
  async queueChange(
    projectId: string,
    userId: string,
    changeType: ProjectChangeType,
    data: any,
    previousData?: any
  ): Promise<void> {
    const changeItem: ChangeQueueItem = {
      projectId,
      userId,
      changeType,
      data,
      previousData,
      timestamp: new Date(),
      id: this.generateChangeId(),
    };

    // Add to queue
    if (!this.changeQueue.has(projectId)) {
      this.changeQueue.set(projectId, []);
    }
    
    const queue = this.changeQueue.get(projectId)!;
    queue.push(changeItem);

    // Limit queue size
    if (queue.length > this.MAX_QUEUE_SIZE) {
      queue.shift(); // Remove oldest change
    }

    // Schedule save with debouncing
    this.scheduleSave(projectId);

    // Emit change event for real-time updates
    this.emit('change_queued', {
      projectId,
      changeId: changeItem.id,
      changeType,
      userId,
      timestamp: changeItem.timestamp,
    });

    loggingService.logInfo('Change queued for persistence', {
      projectId,
      changeType,
      userId,
      changeId: changeItem.id,
    });
  }

  /**
   * Schedule automatic save with debouncing
   */
  private scheduleSave(projectId: string): void {
    // Clear existing timer
    const existingTimer = this.saveTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new save
    const timer = setTimeout(async () => {
      try {
        await this.processPendingChanges(projectId);
        this.saveTimers.delete(projectId);
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to process pending changes'),
          { projectId }
        );
      }
    }, this.SAVE_DEBOUNCE_MS);

    this.saveTimers.set(projectId, timer);
  }

  /**
   * Process all pending changes for a project
   */
  private async processPendingChanges(projectId: string): Promise<void> {
    const queue = this.changeQueue.get(projectId);
    if (!queue || queue.length === 0) return;

    // Acquire lock for conflict resolution
    const lock = await this.acquireLock(projectId);
    if (!lock) {
      // Retry later if lock acquisition fails
      this.scheduleSave(projectId);
      return;
    }

    try {
      // Process changes in order
      const processedChanges: ProjectChangeRecord[] = [];
      
      for (const changeItem of queue) {
        try {
          // Check for conflicts
          const conflictResolution = await this.resolveConflicts(changeItem);
          
          // Record the change
          const changeRecord = await this.projectStateManager.recordChange(
            changeItem.projectId,
            changeItem.userId,
            changeItem.changeType,
            conflictResolution.resolvedData,
            changeItem.previousData
          );

          processedChanges.push(changeRecord);

          // Add to history for rollback capability
          this.addToHistory(projectId, changeRecord);

        } catch (error) {
          loggingService.logError(
            error instanceof Error ? error : new Error('Failed to process change'),
            { 
              projectId,
              changeId: changeItem.id,
              changeType: changeItem.changeType,
            }
          );
        }
      }

      // Clear processed changes from queue
      this.changeQueue.set(projectId, []);

      // Update project last saved timestamp
      await this.projectStateManager.forceSave(projectId, 'system');

      // Emit completion event
      this.emit('changes_persisted', {
        projectId,
        changeCount: processedChanges.length,
        timestamp: new Date(),
      });

      loggingService.logInfo('Changes persisted successfully', {
        projectId,
        changeCount: processedChanges.length,
      });

    } finally {
      // Always release the lock
      this.releaseLock(projectId);
    }
  }

  /**
   * Force immediate save of all pending changes
   */
  async forceSave(projectId: string): Promise<void> {
    // Cancel scheduled save
    const existingTimer = this.saveTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.saveTimers.delete(projectId);
    }

    // Process immediately
    await this.processPendingChanges(projectId);
  }

  // ============================================================================
  // Conflict Resolution
  // ============================================================================

  /**
   * Acquire a lock for a project to prevent concurrent writes
   */
  private async acquireLock(projectId: string): Promise<ProjectLock | null> {
    const existingLock = this.lockManager.get(projectId);
    
    // Check if existing lock is still valid
    if (existingLock && Date.now() - existingLock.acquiredAt < this.LOCK_TIMEOUT_MS) {
      return null; // Lock is held by another process
    }

    // Create new lock
    const lock: ProjectLock = {
      projectId,
      acquiredAt: Date.now(),
      lockId: this.generateLockId(),
    };

    this.lockManager.set(projectId, lock);
    return lock;
  }

  /**
   * Release a lock for a project
   */
  private releaseLock(projectId: string): void {
    this.lockManager.delete(projectId);
  }

  /**
   * Resolve conflicts in concurrent changes
   */
  private async resolveConflicts(changeItem: ChangeQueueItem): Promise<ConflictResolution> {
    // Get current project state
    const currentState = await this.projectStateManager.getCompleteProjectState(changeItem.projectId);
    if (!currentState) {
      throw new Error(`Project ${changeItem.projectId} not found`);
    }

    // Check for conflicts based on change type
    const conflicts = await this.detectConflicts(changeItem, currentState);
    
    if (conflicts.length === 0) {
      // No conflicts, use original data
      return {
        hasConflicts: false,
        resolvedData: changeItem.data,
        conflicts: [],
      };
    }

    // Resolve conflicts using last-write-wins strategy with merge
    const resolvedData = await this.mergeConflictingChanges(changeItem, conflicts, currentState);

    return {
      hasConflicts: true,
      resolvedData,
      conflicts,
    };
  }

  /**
   * Detect conflicts in a change
   */
  private async detectConflicts(
    changeItem: ChangeQueueItem,
    currentState: CompleteProjectState
  ): Promise<ChangeConflict[]> {
    const conflicts: ChangeConflict[] = [];

    // Get recent changes since this change was created
    const recentChanges = await this.projectStateManager.getChangesSince(
      changeItem.projectId,
      new Date(changeItem.timestamp.getTime() - 1000) // 1 second buffer
    );

    // Check for conflicts based on change type
    for (const recentChange of recentChanges) {
      if (recentChange.timestamp > changeItem.timestamp) {
        const conflict = this.analyzeConflict(changeItem, recentChange, currentState);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    return conflicts;
  }

  /**
   * Analyze if two changes conflict
   */
  private analyzeConflict(
    changeItem: ChangeQueueItem,
    recentChange: ProjectChangeRecord,
    _currentState: CompleteProjectState
  ): ChangeConflict | null {
    // Same user changes don't conflict
    if (changeItem.userId === recentChange.userId) {
      return null;
    }

    // Check for resource conflicts based on change type
    const resourceConflict = this.checkResourceConflict(changeItem, recentChange);
    if (!resourceConflict) {
      return null;
    }

    return {
      conflictType: resourceConflict,
      changeItem,
      conflictingChange: recentChange,
      detectedAt: new Date(),
    };
  }

  /**
   * Check if changes conflict on the same resource
   */
  private checkResourceConflict(
    changeItem: ChangeQueueItem,
    recentChange: ProjectChangeRecord
  ): ConflictType | null {
    // Track/Region conflicts
    if (this.isTrackOrRegionChange(changeItem.changeType) && 
        this.isTrackOrRegionChange(recentChange.changeType)) {
      
      const itemResourceId = this.extractResourceId(changeItem);
      const recentResourceId = this.extractResourceId(recentChange);
      
      if (itemResourceId && recentResourceId && itemResourceId === recentResourceId) {
        return 'resource_conflict';
      }
    }

    // Project-level conflicts
    if (changeItem.changeType === 'project_update' && recentChange.changeType === 'project_update') {
      return 'project_conflict';
    }

    return null;
  }

  /**
   * Merge conflicting changes using intelligent merge strategy
   */
  private async mergeConflictingChanges(
    changeItem: ChangeQueueItem,
    conflicts: ChangeConflict[],
    currentState: CompleteProjectState
  ): Promise<any> {
    // For now, use last-write-wins with field-level merging
    let resolvedData = { ...changeItem.data };

    // Apply field-level merging for object updates
    if (changeItem.changeType.includes('update') && typeof changeItem.data === 'object') {
      // Get the current state of the resource
      const currentResourceState = this.getCurrentResourceState(changeItem, currentState);
      
      if (currentResourceState) {
        // Merge non-conflicting fields
        resolvedData = this.mergeNonConflictingFields(
          changeItem.data,
          currentResourceState,
          conflicts
        );
      }
    }

    loggingService.logInfo('Conflicts resolved using merge strategy', {
      projectId: changeItem.projectId,
      changeType: changeItem.changeType,
      conflictCount: conflicts.length,
    });

    return resolvedData;
  }

  // ============================================================================
  // Change History and Rollback
  // ============================================================================

  /**
   * Add change to history for rollback capability
   */
  private addToHistory(projectId: string, change: ProjectChangeRecord): void {
    if (!this.changeHistory.has(projectId)) {
      this.changeHistory.set(projectId, []);
    }

    const history = this.changeHistory.get(projectId)!;
    history.push(change);

    // Limit history size
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift(); // Remove oldest change
    }
  }

  /**
   * Get change history for a project
   */
  async getChangeHistory(projectId: string, limit?: number): Promise<ProjectChangeRecord[]> {
    const history = this.changeHistory.get(projectId) || [];
    return limit ? history.slice(-limit) : [...history];
  }

  /**
   * Rollback to a specific change
   */
  async rollbackToChange(projectId: string, changeId: string, userId: string): Promise<boolean> {
    const history = this.changeHistory.get(projectId);
    if (!history) return false;

    const targetChangeIndex = history.findIndex(change => change.id === changeId);
    if (targetChangeIndex === -1) return false;

    // Get changes to rollback (all changes after the target)
    const changesToRollback = history.slice(targetChangeIndex + 1);

    // Apply rollback in reverse order
    for (let i = changesToRollback.length - 1; i >= 0; i--) {
      const change = changesToRollback[i];
      
      if (!change) continue; // Skip if change is undefined
      
      try {
        // Create inverse change
        const inverseChange = this.createInverseChange(change);
        
        // Apply inverse change
        await this.queueChange(
          projectId,
          userId,
          inverseChange.changeType,
          inverseChange.data,
          change.data
        );
        
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to rollback change'),
          { projectId, changeId: change.id }
        );
        return false;
      }
    }

    // Force save rollback changes
    await this.forceSave(projectId);

    loggingService.logInfo('Project rolled back successfully', {
      projectId,
      targetChangeId: changeId,
      rolledBackChanges: changesToRollback.length,
    });

    return true;
  }

  /**
   * Create inverse of a change for rollback
   */
  private createInverseChange(change: ProjectChangeRecord): InverseChange {
    switch (change.changeType) {
      case 'track_create':
        return {
          changeType: 'track_delete',
          data: { trackId: change.data.track.id },
        };
      
      case 'track_delete':
        return {
          changeType: 'track_create',
          data: change.previousData,
        };
      
      case 'track_update':
        return {
          changeType: 'track_update',
          data: change.previousData,
        };
      
      case 'region_create':
        return {
          changeType: 'region_delete',
          data: { regionId: change.data.region.id },
        };
      
      case 'region_delete':
        return {
          changeType: 'region_create',
          data: change.previousData,
        };
      
      case 'region_update':
        return {
          changeType: 'region_update',
          data: change.previousData,
        };
      
      case 'project_update':
        return {
          changeType: 'project_update',
          data: change.previousData,
        };
      
      default:
        throw new Error(`Cannot create inverse for change type: ${change.changeType}`);
    }
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  private setupEventListeners(): void {
    // Listen to project state manager events
    this.projectStateManager.on('project_updated', (event) => {
      this.queueChange(event.projectId, event.userId, 'project_update', event.updates);
    });

    this.projectStateManager.on('track_created', (_event) => {
      // Track creation is already handled by the state manager
    });

    this.projectStateManager.on('track_updated', (event) => {
      this.queueChange(event.projectId, event.userId, 'track_update', event.updates);
    });

    this.projectStateManager.on('region_created', (_event) => {
      // Region creation is already handled by the state manager
    });

    this.projectStateManager.on('region_updated', (event) => {
      this.queueChange(event.projectId, event.userId, 'region_update', event.updates);
    });
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private generateChangeId(): string {
    return `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateLockId(): string {
    return `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isTrackOrRegionChange(changeType: ProjectChangeType): boolean {
    return changeType.startsWith('track_') || changeType.startsWith('region_');
  }

  private extractResourceId(changeItem: ChangeQueueItem | ProjectChangeRecord): string | null {
    if (changeItem.changeType.startsWith('track_')) {
      return changeItem.data.trackId || changeItem.data.track?.id || null;
    }
    if (changeItem.changeType.startsWith('region_')) {
      return changeItem.data.regionId || changeItem.data.region?.id || null;
    }
    return null;
  }

  private getCurrentResourceState(changeItem: ChangeQueueItem, currentState: CompleteProjectState): any {
    const resourceId = this.extractResourceId(changeItem);
    if (!resourceId) return null;

    if (changeItem.changeType.startsWith('track_')) {
      return currentState.tracks.find(track => track.id === resourceId);
    }
    if (changeItem.changeType.startsWith('region_')) {
      return currentState.regions.find(region => region.id === resourceId);
    }
    if (changeItem.changeType === 'project_update') {
      return currentState.project;
    }

    return null;
  }

  private mergeNonConflictingFields(
    newData: any,
    currentData: any,
    _conflicts: ChangeConflict[]
  ): any {
    // Simple field-level merge - in a real implementation, this would be more sophisticated
    const merged = { ...currentData, ...newData };
    
    // For now, just use the new data (last-write-wins)
    // In a more advanced implementation, we could analyze which specific fields conflict
    
    return merged;
  }

  /**
   * Get statistics about the change service
   */
  getStats(): ChangeServiceStats {
    const queueSizes = Array.from(this.changeQueue.values()).map(queue => queue.length);
    const totalQueueSize = queueSizes.reduce((sum, size) => sum + size, 0);
    
    return {
      activeProjects: this.changeQueue.size,
      totalQueuedChanges: totalQueueSize,
      activeLocks: this.lockManager.size,
      historySize: Array.from(this.changeHistory.values()).reduce((sum, history) => sum + history.length, 0),
      pendingSaves: this.saveTimers.size,
    };
  }

  /**
   * Cleanup old data and timers
   */
  async cleanup(): Promise<void> {
    // Clear all timers
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer);
    }
    this.saveTimers.clear();

    // Clear locks
    this.lockManager.clear();

    // Process any remaining changes
    for (const projectId of this.changeQueue.keys()) {
      try {
        await this.processPendingChanges(projectId);
      } catch (error) {
        loggingService.logError(
          error instanceof Error ? error : new Error('Failed to process changes during cleanup'),
          { projectId }
        );
      }
    }

    loggingService.logInfo('RealTimeChangeService cleanup completed');
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

interface ChangeQueueItem {
  id: string;
  projectId: string;
  userId: string;
  changeType: ProjectChangeType;
  data: any;
  previousData?: any;
  timestamp: Date;
}

interface ProjectLock {
  projectId: string;
  lockId: string;
  acquiredAt: number;
}

interface ConflictResolution {
  hasConflicts: boolean;
  resolvedData: any;
  conflicts: ChangeConflict[];
}

interface ChangeConflict {
  conflictType: ConflictType;
  changeItem: ChangeQueueItem;
  conflictingChange: ProjectChangeRecord;
  detectedAt: Date;
}

type ConflictType = 'resource_conflict' | 'project_conflict' | 'timing_conflict';

interface InverseChange {
  changeType: ProjectChangeType;
  data: any;
}

interface ChangeServiceStats {
  activeProjects: number;
  totalQueuedChanges: number;
  activeLocks: number;
  historySize: number;
  pendingSaves: number;
}