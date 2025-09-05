import { EventBus } from '../../../../shared/domain/events/EventBus';
import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import { 
  RoomCreated, 
  MemberJoined, 
  MemberLeft, 
  OwnershipTransferred,
  RoomClosed,
  RoomSettingsUpdated
} from '../../../../shared/domain/events/RoomEvents';
import { LobbyIntegrationService } from '../LobbyIntegrationService';
import { 
  RoomListingsRefreshed, 
  RoomLobbyStatusChanged,
  LobbyMetricsCollected 
} from '../../domain/events/LobbyEvents';
import { loggingService } from '../../../../services/LoggingService';

/**
 * LobbyEventHandlers
 * 
 * Handles domain events from other bounded contexts to keep lobby
 * room listings up-to-date in real-time. Implements efficient room discovery
 * without affecting room performance through batching and caching strategies.
 * 
 * Requirements: 9.4, 9.6
 */
export class LobbyEventHandlers {
  private updateBatch: Map<string, RoomUpdateInfo> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL_MS = 1000; // 1 second batching
  private readonly MAX_BATCH_SIZE = 50;
  private metricsCollectionTimer: NodeJS.Timeout | null = null;
  private readonly METRICS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private eventBus: EventBus,
    private lobbyIntegrationService: LobbyIntegrationService
  ) {
    this.setupEventHandlers();
    this.startMetricsCollection();
  }

  /**
   * Set up event handlers for room-related events
   */
  private setupEventHandlers(): void {
    // Handle room lifecycle events
    this.eventBus.subscribe(RoomCreated.name, this.handleRoomCreated.bind(this));
    this.eventBus.subscribe(RoomClosed.name, this.handleRoomClosed.bind(this));
    
    // Handle room membership events
    this.eventBus.subscribe(MemberJoined.name, this.handleMemberJoined.bind(this));
    this.eventBus.subscribe(MemberLeft.name, this.handleMemberLeft.bind(this));
    this.eventBus.subscribe(OwnershipTransferred.name, this.handleOwnershipTransferred.bind(this));
    
    // Handle room settings changes
    this.eventBus.subscribe(RoomSettingsUpdated.name, this.handleRoomSettingsUpdated.bind(this));
  }

  /**
   * Handle room created event
   */
  private async handleRoomCreated(event: RoomCreated): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room created', {
        roomId: event.aggregateId,
        roomName: event.roomName,
        ownerId: event.ownerId,
        isPrivate: event.isPrivate
      });

      // Add to batch for efficient processing
      this.addToBatch(event.aggregateId, {
        type: 'created',
        timestamp: event.occurredOn
      });

      // Publish lobby-specific event
      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'room_change'
      ));

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle room created',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Handle room closed event
   */
  private async handleRoomClosed(event: RoomClosed): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room closed', {
        roomId: event.aggregateId,
        closedBy: event.closedBy,
        reason: event.reason
      });

      // Add to batch for efficient processing
      this.addToBatch(event.aggregateId, {
        type: 'deleted',
        timestamp: event.occurredOn
      });

      // Publish lobby-specific event
      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'room_change'
      ));

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle room closed',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Handle member joined event
   */
  private async handleMemberJoined(event: MemberJoined): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Member joined room', {
        roomId: event.aggregateId,
        userId: event.userId,
        username: event.username,
        role: event.role
      });

      // Add to batch for efficient processing
      this.addToBatch(event.aggregateId, {
        type: 'updated',
        timestamp: event.occurredOn
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle member joined',
        roomId: event.aggregateId,
        userId: event.userId
      });
    }
  }

  /**
   * Handle member left event
   */
  private async handleMemberLeft(event: MemberLeft): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Member left room', {
        roomId: event.aggregateId,
        userId: event.userId,
        username: event.username
      });

      // Add to batch for efficient processing
      this.addToBatch(event.aggregateId, {
        type: 'updated',
        timestamp: event.occurredOn
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle member left',
        roomId: event.aggregateId,
        userId: event.userId
      });
    }
  }

  /**
   * Handle ownership transferred event
   */
  private async handleOwnershipTransferred(event: OwnershipTransferred): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room ownership transferred', {
        roomId: event.aggregateId,
        previousOwnerId: event.previousOwnerId,
        newOwnerId: event.newOwnerId
      });

      // Add to batch for efficient processing
      this.addToBatch(event.aggregateId, {
        type: 'updated',
        timestamp: event.occurredOn
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle ownership transferred',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Broadcast room update to lobby clients
   */
  private async broadcastRoomUpdate(roomId: string): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      // Get room listing through the repository
      const roomListing = await lobbyService['roomListingRepository'].findById(
        { toString: () => roomId } as any
      );

      if (roomListing) {
        const roomSummary = roomListing.toSummary();
        this.lobbyIntegrationService.broadcastRoomUpdate('updated', roomSummary);
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Broadcast room update',
        roomId
      });
    }
  }

  /**
   * Get total room count for statistics
   */
  private async getTotalRoomCount(): Promise<number> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();
      return statistics.totalRooms;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Get total room count'
      });
      return 0;
    }
  }

  /**
   * Get active room count for statistics
   */
  private async getActiveRoomCount(): Promise<number> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();
      return statistics.activeRooms;
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Get active room count'
      });
      return 0;
    }
  }

  /**
   * Handle room privacy changes
   */
  async handleRoomPrivacyChange(roomId: string, isPrivate: boolean): Promise<void> {
    try {
      // Publish lobby status change event
      await this.eventBus.publish(new RoomLobbyStatusChanged(
        roomId,
        !isPrivate, // Visible in lobby if not private
        'privacy_change'
      ));

      // Broadcast update
      await this.broadcastRoomUpdate(roomId);

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle room privacy change',
        roomId,
        isPrivate
      });
    }
  }

  /**
   * Handle room activity changes
   */
  async handleRoomActivityChange(roomId: string, isActive: boolean): Promise<void> {
    try {
      // Publish lobby status change event
      await this.eventBus.publish(new RoomLobbyStatusChanged(
        roomId,
        isActive,
        'activity_change'
      ));

      // Broadcast update
      await this.broadcastRoomUpdate(roomId);

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle room activity change',
        roomId,
        isActive
      });
    }
  }

  /**
   * Refresh all room listings
   */
  async refreshRoomListings(): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      await lobbyService.refreshRoomListings();

      // Publish refresh event
      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'manual'
      ));

      // Update lobby statistics
      await this.lobbyIntegrationService.broadcastLobbyStatistics();

      loggingService.logInfo('Lobby: Room listings refreshed');

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Refresh room listings'
      });
    }
  }

  /**
   * Cleanup inactive rooms
   */
  async cleanupInactiveRooms(olderThanHours: number = 24): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const cleanedCount = await lobbyService.cleanupInactiveRooms(olderThanHours);

      if (cleanedCount > 0) {
        loggingService.logInfo('Lobby: Cleaned up inactive rooms', {
          cleanedCount,
          olderThanHours
        });

        // Refresh listings after cleanup
        await this.refreshRoomListings();
      }

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Cleanup inactive rooms',
        olderThanHours
      });
    }
  }

  /**
   * Handle room settings updated event
   */
  private async handleRoomSettingsUpdated(event: RoomSettingsUpdated): Promise<void> {
    try {
      loggingService.logInfo('Lobby: Room settings updated', {
        roomId: event.aggregateId,
        updatedBy: event.updatedBy,
        changes: event.changes
      });

      // Check if changes affect lobby visibility
      const affectsLobby = this.checkIfSettingsAffectLobby(event.changes);
      
      if (affectsLobby) {
        // Add to batch for efficient processing
        this.addToBatch(event.aggregateId, {
          type: 'settings_updated',
          timestamp: event.occurredOn,
          changes: event.changes
        });

        // Publish lobby status change if privacy changed
        if ('isPrivate' in event.changes) {
          await this.eventBus.publish(new RoomLobbyStatusChanged(
            event.aggregateId,
            !event.changes.isPrivate,
            'privacy_change'
          ));
        }
      }

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle room settings updated',
        roomId: event.aggregateId
      });
    }
  }

  /**
   * Check if room settings changes affect lobby visibility
   */
  private checkIfSettingsAffectLobby(changes: Record<string, any>): boolean {
    const lobbyAffectingSettings = [
      'isPrivate',
      'requiresApproval', 
      'maxMembers',
      'genres',
      'description',
      'name'
    ];

    return Object.keys(changes).some(key => lobbyAffectingSettings.includes(key));
  }

  /**
   * Add room update to batch for efficient processing
   */
  private addToBatch(roomId: string, updateInfo: RoomUpdateInfo): void {
    // Update or add to batch
    const existing = this.updateBatch.get(roomId);
    if (existing) {
      // Merge updates, keeping the latest timestamp
      this.updateBatch.set(roomId, {
        ...existing,
        ...updateInfo,
        timestamp: updateInfo.timestamp > existing.timestamp ? updateInfo.timestamp : existing.timestamp
      });
    } else {
      this.updateBatch.set(roomId, updateInfo);
    }

    // Process batch if it gets too large
    if (this.updateBatch.size >= this.MAX_BATCH_SIZE) {
      this.processBatch();
    } else {
      // Schedule batch processing
      this.scheduleBatchProcessing();
    }
  }

  /**
   * Schedule batch processing with debouncing
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.BATCH_INTERVAL_MS);
  }

  /**
   * Process batched room updates efficiently
   */
  private async processBatch(): Promise<void> {
    if (this.updateBatch.size === 0) {
      return;
    }

    const batchToProcess = new Map(this.updateBatch);
    this.updateBatch.clear();

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    try {
      loggingService.logInfo('Lobby: Processing batched room updates', {
        batchSize: batchToProcess.size
      });

      // Process updates in parallel for efficiency
      const updatePromises = Array.from(batchToProcess.entries()).map(
        async ([roomId, updateInfo]) => {
          try {
            await this.processRoomUpdate(roomId, updateInfo);
          } catch (error) {
            loggingService.logError(error as Error, {
              context: 'Lobby: Process room update in batch',
              roomId,
              updateInfo
            });
          }
        }
      );

      await Promise.allSettled(updatePromises);

      // Broadcast batch completion
      await this.broadcastBatchUpdate(batchToProcess);

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Process batch',
        batchSize: batchToProcess.size
      });
    }
  }

  /**
   * Process individual room update
   */
  private async processRoomUpdate(roomId: string, updateInfo: RoomUpdateInfo): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      
      // Get updated room listing
      const roomListing = await lobbyService['roomListingRepository'].findById(
        { toString: () => roomId } as any
      );

      if (roomListing) {
        const roomSummary = roomListing.toSummary();
        
        // Determine update type based on the update info
        let updateType: 'created' | 'updated' | 'deleted' = 'updated';
        if (updateInfo.type === 'created') {
          updateType = 'created';
        } else if (updateInfo.type === 'deleted') {
          updateType = 'deleted';
        }

        // Store for batch broadcast
        updateInfo.roomSummary = roomSummary;
        updateInfo.updateType = updateType;
      }

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Process room update',
        roomId,
        updateInfo
      });
    }
  }

  /**
   * Broadcast batched updates to lobby clients
   */
  private async broadcastBatchUpdate(batchUpdates: Map<string, RoomUpdateInfo>): Promise<void> {
    try {
      const lobbyNamespace = this.lobbyIntegrationService['io'].of('/lobby');
      
      // Group updates by type for efficient broadcasting
      const groupedUpdates = {
        created: [] as any[],
        updated: [] as any[],
        deleted: [] as any[]
      };

      for (const [roomId, updateInfo] of batchUpdates) {
        if (updateInfo.roomSummary && updateInfo.updateType) {
          groupedUpdates[updateInfo.updateType].push({
            roomId,
            room: updateInfo.roomSummary,
            timestamp: updateInfo.timestamp
          });
        }
      }

      // Broadcast grouped updates
      if (groupedUpdates.created.length > 0) {
        lobbyNamespace.to('lobby_updates').emit('rooms_batch_created', {
          rooms: groupedUpdates.created,
          count: groupedUpdates.created.length,
          timestamp: Date.now()
        });
      }

      if (groupedUpdates.updated.length > 0) {
        lobbyNamespace.to('lobby_updates').emit('rooms_batch_updated', {
          rooms: groupedUpdates.updated,
          count: groupedUpdates.updated.length,
          timestamp: Date.now()
        });
      }

      if (groupedUpdates.deleted.length > 0) {
        lobbyNamespace.to('lobby_updates').emit('rooms_batch_deleted', {
          rooms: groupedUpdates.deleted,
          count: groupedUpdates.deleted.length,
          timestamp: Date.now()
        });
      }

      // Update lobby statistics if significant changes
      const totalChanges = groupedUpdates.created.length + 
                          groupedUpdates.updated.length + 
                          groupedUpdates.deleted.length;
      
      if (totalChanges >= 5) {
        await this.lobbyIntegrationService.broadcastLobbyStatistics();
      }

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Broadcast batch update',
        batchSize: batchUpdates.size
      });
    }
  }

  /**
   * Start periodic metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsCollectionTimer = setInterval(async () => {
      await this.collectAndPublishMetrics();
    }, this.METRICS_INTERVAL_MS);
  }

  /**
   * Collect and publish lobby metrics
   */
  private async collectAndPublishMetrics(): Promise<void> {
    try {
      const lobbyService = this.lobbyIntegrationService.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();

      // Calculate metrics
      const averageSearchTime = await this.calculateAverageSearchTime();
      const totalSearches = await this.getTotalSearchCount();
      const popularGenres = statistics.popularGenres.slice(0, 5).map(g => g.genre);
      const peakConcurrentUsers = await this.getPeakConcurrentUsers();

      // Publish metrics event
      await this.eventBus.publish(new LobbyMetricsCollected(
        averageSearchTime,
        totalSearches,
        popularGenres,
        peakConcurrentUsers,
        '5m'
      ));

      loggingService.logInfo('Lobby: Metrics collected and published', {
        averageSearchTime,
        totalSearches,
        popularGenres: popularGenres.length,
        peakConcurrentUsers
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Collect and publish metrics'
      });
    }
  }

  /**
   * Calculate average search time from recent searches
   */
  private async calculateAverageSearchTime(): Promise<number> {
    // This would typically query a metrics store or cache
    // For now, return a placeholder value
    return 150; // 150ms average
  }

  /**
   * Get total search count in the current time window
   */
  private async getTotalSearchCount(): Promise<number> {
    // This would typically query a metrics store or cache
    // For now, return a placeholder value
    return 0;
  }

  /**
   * Get peak concurrent users in the lobby
   */
  private async getPeakConcurrentUsers(): Promise<number> {
    try {
      const lobbyNamespace = this.lobbyIntegrationService['io'].of('/lobby');
      return lobbyNamespace.sockets.size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Handle real-time room activity updates
   */
  async handleRoomActivityUpdate(roomId: string, activityData: RoomActivityData): Promise<void> {
    try {
      // Add to batch for efficient processing
      this.addToBatch(roomId, {
        type: 'activity_updated',
        timestamp: new Date(),
        activityData
      });

      // Publish activity change event if significant
      if (this.isSignificantActivityChange(activityData)) {
        await this.eventBus.publish(new RoomLobbyStatusChanged(
          roomId,
          activityData.isActive,
          'activity_change'
        ));
      }

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Lobby: Handle room activity update',
        roomId,
        activityData
      });
    }
  }

  /**
   * Check if activity change is significant enough to broadcast
   */
  private isSignificantActivityChange(activityData: RoomActivityData): boolean {
    // Consider significant if:
    // - Room becomes active/inactive
    // - Member count changes by more than 20%
    // - First activity in over 30 minutes
    return activityData.memberCountChange > 0.2 || 
           activityData.wasInactiveFor > 30 * 60 * 1000;
  }

  /**
   * Shutdown the event handlers and cleanup resources
   */
  shutdown(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
      this.metricsCollectionTimer = null;
    }

    // Process any remaining batched updates
    if (this.updateBatch.size > 0) {
      this.processBatch();
    }
  }
}

/**
 * Interface for room update information in batches
 */
interface RoomUpdateInfo {
  type: 'created' | 'updated' | 'deleted' | 'settings_updated' | 'activity_updated';
  timestamp: Date;
  changes?: Record<string, any>;
  activityData?: RoomActivityData;
  roomSummary?: any;
  updateType?: 'created' | 'updated' | 'deleted';
}

/**
 * Interface for room activity data
 */
interface RoomActivityData {
  isActive: boolean;
  memberCount: number;
  memberCountChange: number;
  lastActivity: Date;
  wasInactiveFor: number;
}