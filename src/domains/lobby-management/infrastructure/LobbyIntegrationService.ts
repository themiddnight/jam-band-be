import { Server, Namespace } from 'socket.io';
import { LobbyApplicationService } from '../application/LobbyApplicationService';
import { RoomDiscoveryService } from '../domain/services/RoomDiscoveryService';
import { RoomServiceRoomListingRepository } from './repositories/RoomServiceRoomListingRepository';
import { CachedRoomListingRepository } from './repositories/CachedRoomListingRepository';
import { LobbyNamespaceHandlers } from './handlers/LobbyNamespaceHandlers';
import { LobbyEventHandlers } from './handlers/LobbyEventHandlers';
import { EventBus } from '../../../shared/domain/events/EventBus';
import { RoomService } from '../../../services/RoomService';

/**
 * LobbyIntegrationService
 * 
 * Integrates the lobby management bounded context with the existing system.
 * Provides a facade for setting up lobby functionality with caching and event handling.
 * 
 * Requirements: 9.2, 9.3, 9.6
 */
export class LobbyIntegrationService {
  private lobbyApplicationService: LobbyApplicationService;
  private lobbyNamespaceHandlers: LobbyNamespaceHandlers;
  private lobbyEventHandlers: LobbyEventHandlers;
  private roomDiscoveryService: RoomDiscoveryService;
  private roomListingRepository: CachedRoomListingRepository;

  constructor(
    private io: Server,
    private roomService: RoomService,
    private eventBus: EventBus
  ) {
    // Initialize domain services
    this.roomDiscoveryService = new RoomDiscoveryService();
    
    // Initialize infrastructure with caching
    const baseRepository = new RoomServiceRoomListingRepository(roomService);
    this.roomListingRepository = new CachedRoomListingRepository(baseRepository);
    
    // Initialize application service
    this.lobbyApplicationService = new LobbyApplicationService(
      this.roomListingRepository,
      this.roomDiscoveryService,
      this.eventBus
    );
    
    // Initialize handlers
    this.lobbyNamespaceHandlers = new LobbyNamespaceHandlers(this.lobbyApplicationService);
    this.lobbyEventHandlers = new LobbyEventHandlers(this.eventBus, this);
  }

  /**
   * Creates and sets up the lobby namespace
   */
  createLobbyNamespace(): Namespace {
    const namespacePath = '/lobby';
    const namespace = this.io.of(namespacePath);
    
    // Set up lobby event handlers
    this.lobbyNamespaceHandlers.setupLobbyNamespaceHandlers(namespace);
    
    return namespace;
  }

  /**
   * Gets the lobby application service for external use
   */
  getLobbyApplicationService(): LobbyApplicationService {
    return this.lobbyApplicationService;
  }

  /**
   * Gets the lobby namespace handlers for external use
   */
  getLobbyNamespaceHandlers(): LobbyNamespaceHandlers {
    return this.lobbyNamespaceHandlers;
  }

  /**
   * Gets the lobby event handlers for external use
   */
  getLobbyEventHandlers(): LobbyEventHandlers {
    return this.lobbyEventHandlers;
  }

  /**
   * Gets cache statistics for monitoring
   */
  getCacheStatistics() {
    return this.roomListingRepository.getCacheStatistics();
  }

  /**
   * Manually invalidate cache
   */
  invalidateCache(): void {
    this.roomListingRepository.invalidateCache();
  }

  /**
   * Broadcasts room updates to lobby clients
   */
  broadcastRoomUpdate(updateType: 'created' | 'updated' | 'deleted', roomSummary: any): void {
    const lobbyNamespace = this.io.of('/lobby');
    this.lobbyNamespaceHandlers.broadcastRoomListUpdate(lobbyNamespace, updateType, roomSummary);
  }

  /**
   * Broadcasts lobby statistics updates
   */
  async broadcastLobbyStatistics(): Promise<void> {
    try {
      const statistics = await this.lobbyApplicationService.getLobbyStatistics();
      const lobbyNamespace = this.io.of('/lobby');
      this.lobbyNamespaceHandlers.broadcastLobbyStatistics(lobbyNamespace, statistics);
    } catch (error) {
      console.error('Failed to broadcast lobby statistics:', error);
    }
  }

  /**
   * Shutdown the integration service and cleanup resources
   */
  shutdown(): void {
    this.roomListingRepository.shutdown();
  }
}