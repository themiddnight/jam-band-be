import { EventBus } from '../../../../shared/domain/events/EventBus';
import { DomainEvent } from '../../../../shared/domain/events/DomainEvent';
import { 
  RoomCreated, 
  MemberJoined, 
  MemberLeft, 
  OwnershipTransferred,
  RoomClosed 
} from '../../../../shared/domain/events/RoomEvents';
import { LobbyIntegrationService } from '../LobbyIntegrationService';
import { RoomListingsRefreshed, RoomLobbyStatusChanged } from '../../domain/events/LobbyEvents';
import { loggingService } from '../../../../services/LoggingService';

/**
 * LobbyEventHandlers
 * 
 * Handles domain events from other bounded contexts to keep lobby
 * room listings up-to-date in real-time.
 * 
 * Requirements: 9.4, 9.6
 */
export class LobbyEventHandlers {
  constructor(
    private eventBus: EventBus,
    private lobbyIntegrationService: LobbyIntegrationService
  ) {
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for room-related events
   */
  private setupEventHandlers(): void {
    // Handle room lifecycle events
    this.eventBus.subscribe(RoomCreated, this.handleRoomCreated.bind(this));
    this.eventBus.subscribe(RoomClosed, this.handleRoomClosed.bind(this));
    
    // Handle room membership events
    this.eventBus.subscribe(MemberJoined, this.handleMemberJoined.bind(this));
    this.eventBus.subscribe(MemberLeft, this.handleMemberLeft.bind(this));
    this.eventBus.subscribe(OwnershipTransferred, this.handleOwnershipTransferred.bind(this));
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

      // Create room summary for lobby broadcast
      const roomSummary = {
        id: event.aggregateId,
        name: event.roomName,
        userCount: 1, // Owner just joined
        owner: event.ownerId,
        isPrivate: event.isPrivate,
        isHidden: false,
        createdAt: event.occurredOn
      };

      // Broadcast room creation to lobby clients
      this.lobbyIntegrationService.broadcastRoomUpdate('created', roomSummary);

      // Publish lobby-specific event
      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'room_change'
      ));

      // Update lobby statistics
      await this.lobbyIntegrationService.broadcastLobbyStatistics();

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

      // Create room summary for lobby broadcast
      const roomSummary = {
        id: event.aggregateId,
        reason: event.reason
      };

      // Broadcast room deletion to lobby clients
      this.lobbyIntegrationService.broadcastRoomUpdate('deleted', roomSummary);

      // Publish lobby-specific event
      await this.eventBus.publish(new RoomListingsRefreshed(
        await this.getTotalRoomCount(),
        await this.getActiveRoomCount(),
        'room_change'
      ));

      // Update lobby statistics
      await this.lobbyIntegrationService.broadcastLobbyStatistics();

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

      // Get updated room info and broadcast
      await this.broadcastRoomUpdate(event.aggregateId);

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

      // Get updated room info and broadcast
      await this.broadcastRoomUpdate(event.aggregateId);

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

      // Get updated room info and broadcast
      await this.broadcastRoomUpdate(event.aggregateId);

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
}