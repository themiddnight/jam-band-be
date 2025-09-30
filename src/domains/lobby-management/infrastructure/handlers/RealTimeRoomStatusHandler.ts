import { EventBus } from '../../../../shared/domain/events/EventBus';
import { LobbyIntegrationService } from '../LobbyIntegrationService';
import { RoomLobbyStatusChanged } from '../../domain/events/LobbyEvents';
import { loggingService } from '../../../../services/LoggingService';

/**
 * RealTimeRoomStatusHandler
 * 
 * Handles real-time room status changes and activity monitoring for the lobby.
 * Implements efficient status tracking without affecting room performance through
 * debouncing, throttling, and smart update strategies.
 * 
 * Requirements: 9.4, 9.6
 */
export class RealTimeRoomStatusHandler {
  private roomStatusCache = new Map<string, RoomStatusInfo>();
  private statusUpdateQueue = new Map<string, QueuedStatusUpdate>();
  private processingTimer: NodeJS.Timeout | null = null;
  private readonly PROCESSING_INTERVAL_MS = 2000; // 2 seconds
  private readonly STATUS_CACHE_TTL_MS = 30 * 1000; // 30 seconds
  private readonly MAX_QUEUE_SIZE = 100;

  constructor(
    private eventBus: EventBus,
    private lobbyIntegrationService: LobbyIntegrationService
  ) {
    this.startStatusProcessing();
    this.setupPeriodicCleanup();
  }

  /**
   * Update room status with debouncing and throttling
   */
  async updateRoomStatus(
    roomId: string, 
    status: Partial<RoomStatusInfo>,
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<void> {
    try {
      const now = Date.now();
      const currentStatus = this.roomStatusCache.get(roomId);
      
      // Check if update is necessary
      if (currentStatus && !this.shouldUpdateStatus(currentStatus, status, now)) {
        return;
      }

      // Update cache
      const updatedStatus: RoomStatusInfo = {
        ...currentStatus,
        ...status,
        roomId,
        isActive: status.isActive ?? currentStatus?.isActive ?? true,
        lastUpdated: now,
        updateCount: (currentStatus?.updateCount || 0) + 1
      };

      this.roomStatusCache.set(roomId, updatedStatus);

      // Queue for processing
      this.queueStatusUpdate(roomId, updatedStatus, priority);

      loggingService.logInfo('Lobby: Room status updated', {
        roomId,
        status: Object.keys(status),
        priority,
        queueSize: this.statusUpdateQueue.size
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RealTimeRoomStatusHandler: Update room status',
        roomId,
        status
      });
    }
  }

  /**
   * Handle room activity change
   */
  async handleRoomActivityChange(
    roomId: string,
    activityType: 'member_join' | 'member_leave' | 'audio_start' | 'audio_stop' | 'chat_message',
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const now = Date.now();
      const currentStatus = this.roomStatusCache.get(roomId);
      
      // Calculate activity score based on activity type
      const activityScore = this.calculateActivityScore(activityType, metadata);
      
      // Update room status
      await this.updateRoomStatus(roomId, {
        lastActivity: now,
        activityScore,
        activityType,
        isActive: activityScore > 0.3, // Active if score > 30%
        ...(metadata && { metadata })
      }, this.getActivityPriority(activityType));

      // Publish activity change event if significant
      if (this.isSignificantActivityChange(currentStatus, activityScore)) {
        await this.eventBus.publish(new RoomLobbyStatusChanged(
          roomId,
          activityScore > 0.3,
          'activity_change'
        ));
      }

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RealTimeRoomStatusHandler: Handle room activity change',
        roomId,
        activityType
      });
    }
  }

  /**
   * Handle room member count change
   */
  async handleMemberCountChange(
    roomId: string,
    newCount: number,
    previousCount: number
  ): Promise<void> {
    try {
      const changePercentage = previousCount > 0 
        ? Math.abs(newCount - previousCount) / previousCount 
        : 1;

      // Update status with appropriate priority
      const priority = changePercentage > 0.5 ? 'high' : 'medium';
      
      await this.updateRoomStatus(roomId, {
        memberCount: newCount,
        memberCountChange: changePercentage,
        lastMemberChange: Date.now()
      }, priority);

      // Update activity score based on member count
      const activityScore = Math.min(newCount / 8, 1); // Max activity at 8 members
      await this.updateRoomStatus(roomId, {
        activityScore,
        isActive: newCount > 0
      }, priority);

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RealTimeRoomStatusHandler: Handle member count change',
        roomId,
        newCount,
        previousCount
      });
    }
  }

  /**
   * Handle room privacy change
   */
  async handlePrivacyChange(roomId: string, isPrivate: boolean): Promise<void> {
    try {
      await this.updateRoomStatus(roomId, {
        isPrivate,
        visibilityChanged: Date.now()
      }, 'high');

      // Publish lobby status change
      await this.eventBus.publish(new RoomLobbyStatusChanged(
        roomId,
        !isPrivate, // Visible in lobby if not private
        'privacy_change'
      ));

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RealTimeRoomStatusHandler: Handle privacy change',
        roomId,
        isPrivate
      });
    }
  }

  /**
   * Get room status from cache
   */
  getRoomStatus(roomId: string): RoomStatusInfo | undefined {
    const status = this.roomStatusCache.get(roomId);
    
    // Check if status is still valid
    if (status && Date.now() - status.lastUpdated > this.STATUS_CACHE_TTL_MS) {
      this.roomStatusCache.delete(roomId);
      return undefined;
    }
    
    return status;
  }

  /**
   * Get all active room statuses
   */
  getActiveRoomStatuses(): Map<string, RoomStatusInfo> {
    const now = Date.now();
    const activeStatuses = new Map<string, RoomStatusInfo>();
    
    for (const [roomId, status] of this.roomStatusCache) {
      if (status.isActive && now - status.lastUpdated <= this.STATUS_CACHE_TTL_MS) {
        activeStatuses.set(roomId, status);
      }
    }
    
    return activeStatuses;
  }

  /**
   * Calculate activity score based on activity type
   */
  private calculateActivityScore(
    activityType: string,
    metadata?: Record<string, any>
  ): number {
    const baseScores = {
      'member_join': 0.8,
      'member_leave': 0.6,
      'audio_start': 0.9,
      'audio_stop': 0.4,
      'chat_message': 0.5
    };

    let score = baseScores[activityType as keyof typeof baseScores] || 0.3;

    // Adjust score based on metadata
    if (metadata) {
      if (metadata.memberCount) {
        score *= Math.min(metadata.memberCount / 4, 1.5); // Boost for more members
      }
      if (metadata.isOwnerAction) {
        score *= 1.2; // Boost for owner actions
      }
    }

    return Math.min(score, 1);
  }

  /**
   * Get priority for activity type
   */
  private getActivityPriority(activityType: string): 'low' | 'medium' | 'high' {
    const highPriorityActivities = ['member_join', 'member_leave', 'audio_start'];
    const mediumPriorityActivities = ['audio_stop', 'chat_message'];
    
    if (highPriorityActivities.includes(activityType)) {
      return 'high';
    } else if (mediumPriorityActivities.includes(activityType)) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Check if status update is necessary
   */
  private shouldUpdateStatus(
    currentStatus: RoomStatusInfo,
    newStatus: Partial<RoomStatusInfo>,
    now: number
  ): boolean {
    // Always update if enough time has passed
    if (now - currentStatus.lastUpdated > this.STATUS_CACHE_TTL_MS / 2) {
      return true;
    }

    // Update if significant changes
    if (newStatus.memberCount !== undefined && 
        Math.abs((newStatus.memberCount || 0) - (currentStatus.memberCount || 0)) > 0) {
      return true;
    }

    if (newStatus.isActive !== undefined && 
        newStatus.isActive !== currentStatus.isActive) {
      return true;
    }

    if (newStatus.isPrivate !== undefined && 
        newStatus.isPrivate !== currentStatus.isPrivate) {
      return true;
    }

    return false;
  }

  /**
   * Check if activity change is significant
   */
  private isSignificantActivityChange(
    currentStatus: RoomStatusInfo | undefined,
    newActivityScore: number
  ): boolean {
    if (!currentStatus) {
      return newActivityScore > 0.5;
    }

    const scoreDifference = Math.abs(newActivityScore - (currentStatus.activityScore || 0));
    return scoreDifference > 0.3;
  }

  /**
   * Queue status update for processing
   */
  private queueStatusUpdate(
    roomId: string,
    status: RoomStatusInfo,
    priority: 'low' | 'medium' | 'high'
  ): void {
    // Remove old update if exists
    if (this.statusUpdateQueue.has(roomId)) {
      this.statusUpdateQueue.delete(roomId);
    }

    // Add new update
    this.statusUpdateQueue.set(roomId, {
      roomId,
      status,
      priority,
      queuedAt: Date.now()
    });

    // Limit queue size
    if (this.statusUpdateQueue.size > this.MAX_QUEUE_SIZE) {
      this.processOldestUpdates();
    }
  }

  /**
   * Process oldest updates when queue is full
   */
  private processOldestUpdates(): void {
    const updates = Array.from(this.statusUpdateQueue.values())
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .slice(0, 10); // Process oldest 10

    for (const update of updates) {
      this.statusUpdateQueue.delete(update.roomId);
    }
  }

  /**
   * Start periodic status processing
   */
  private startStatusProcessing(): void {
    this.processingTimer = setInterval(async () => {
      await this.processQueuedUpdates();
    }, this.PROCESSING_INTERVAL_MS);
  }

  /**
   * Process queued status updates
   */
  private async processQueuedUpdates(): Promise<void> {
    if (this.statusUpdateQueue.size === 0) {
      return;
    }

    try {
      const updates = Array.from(this.statusUpdateQueue.values());
      this.statusUpdateQueue.clear();

      // Group by priority
      const highPriority = updates.filter(u => u.priority === 'high');
      const mediumPriority = updates.filter(u => u.priority === 'medium');
      const lowPriority = updates.filter(u => u.priority === 'low');

      // Process high priority first
      await this.processBatchUpdates(highPriority);
      await this.processBatchUpdates(mediumPriority);
      await this.processBatchUpdates(lowPriority);

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RealTimeRoomStatusHandler: Process queued updates'
      });
    }
  }

  /**
   * Process batch of status updates
   */
  private async processBatchUpdates(updates: QueuedStatusUpdate[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    try {
      const lobbyNamespace = this.lobbyIntegrationService['io']?.of('/lobby');
      if (!lobbyNamespace) {
        return;
      }

      // Group updates for efficient broadcasting
      const statusUpdates = updates.map(update => ({
        roomId: update.roomId,
        status: {
          isActive: update.status.isActive,
          memberCount: update.status.memberCount,
          activityScore: update.status.activityScore,
          lastActivity: update.status.lastActivity,
          isPrivate: update.status.isPrivate
        },
        timestamp: update.status.lastUpdated
      }));

      // Broadcast batch status update
      lobbyNamespace.to('lobby_updates').emit('room_statuses_updated', {
        updates: statusUpdates,
        count: statusUpdates.length,
        timestamp: Date.now()
      });

      loggingService.logInfo('Lobby: Processed batch status updates', {
        count: updates.length,
        priorities: updates.map(u => u.priority)
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'RealTimeRoomStatusHandler: Process batch updates',
        updateCount: updates.length
      });
    }
  }

  /**
   * Setup periodic cleanup of old cache entries
   */
  private setupPeriodicCleanup(): void {
    setInterval(() => {
      this.cleanupOldCacheEntries();
    }, this.STATUS_CACHE_TTL_MS);
  }

  /**
   * Clean up old cache entries
   */
  private cleanupOldCacheEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [roomId, status] of this.roomStatusCache) {
      if (now - status.lastUpdated > this.STATUS_CACHE_TTL_MS) {
        this.roomStatusCache.delete(roomId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      loggingService.logInfo('Lobby: Cleaned up old status cache entries', {
        cleanedCount,
        remainingCount: this.roomStatusCache.size
      });
    }
  }

  /**
   * Shutdown the handler and cleanup resources
   */
  shutdown(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    // Process any remaining updates
    if (this.statusUpdateQueue.size > 0) {
      this.processQueuedUpdates();
    }

    this.roomStatusCache.clear();
    this.statusUpdateQueue.clear();
  }
}

/**
 * Interface for room status information
 */
interface RoomStatusInfo {
  roomId: string;
  isActive: boolean;
  memberCount?: number;
  memberCountChange?: number;
  activityScore?: number;
  activityType?: string;
  lastActivity?: number;
  lastMemberChange?: number;
  isPrivate?: boolean;
  visibilityChanged?: number;
  lastUpdated: number;
  updateCount: number;
  metadata?: Record<string, any>;
}

/**
 * Interface for queued status updates
 */
interface QueuedStatusUpdate {
  roomId: string;
  status: RoomStatusInfo;
  priority: 'low' | 'medium' | 'high';
  queuedAt: number;
}