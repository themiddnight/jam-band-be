import { LobbyIntegrationService } from '../infrastructure/LobbyIntegrationService';
import { InMemoryEventBus } from '../../../shared/domain/events/InMemoryEventBus';
import { RoomService } from '../../../services/RoomService';
import { RoomSessionManager } from '../../../services/RoomSessionManager';
import { Server } from 'socket.io';

describe('LobbyIntegration', () => {
  let lobbyIntegration: LobbyIntegrationService;
  let mockIo: Server;
  let roomService: RoomService;
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    // Create mock Socket.IO server
    mockIo = {
      of: jest.fn().mockReturnValue({
        on: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnThis()
      })
    } as any;

    // Create real services
    const roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    eventBus = new InMemoryEventBus();

    // Create integration service
    lobbyIntegration = new LobbyIntegrationService(mockIo, roomService, eventBus);
  });

  afterEach(() => {
    lobbyIntegration.shutdown();
  });

  describe('initialization', () => {
    it('should initialize all components', () => {
      expect(lobbyIntegration.getLobbyApplicationService()).toBeDefined();
      expect(lobbyIntegration.getLobbyNamespaceHandlers()).toBeDefined();
      expect(lobbyIntegration.getLobbyEventHandlers()).toBeDefined();
    });

    it('should create lobby namespace', () => {
      const namespace = lobbyIntegration.createLobbyNamespace();
      
      expect(mockIo.of).toHaveBeenCalledWith('/lobby');
      expect(namespace).toBeDefined();
    });
  });

  describe('room operations', () => {
    it('should get lobby statistics', async () => {
      const lobbyService = lobbyIntegration.getLobbyApplicationService();
      const statistics = await lobbyService.getLobbyStatistics();
      
      expect(statistics).toBeDefined();
      expect(statistics.totalRooms).toBe(0); // No rooms initially
      expect(statistics.activeRooms).toBe(0);
      expect(statistics.availableRooms).toBe(0);
    });

    it('should handle room creation and update statistics', async () => {
      // Create a room through RoomService
      const { room } = roomService.createRoom('Test Room', 'testuser', 'user123');
      
      const lobbyService = lobbyIntegration.getLobbyApplicationService();
      
      // Refresh to pick up the new room
      await lobbyService.refreshRoomListings();
      
      const statistics = await lobbyService.getLobbyStatistics();
      expect(statistics.totalRooms).toBe(1);
    });
  });

  describe('caching', () => {
    it('should provide cache statistics', () => {
      const cacheStats = lobbyIntegration.getCacheStatistics();
      
      expect(cacheStats).toBeDefined();
      expect(cacheStats.roomListings).toBeDefined();
      expect(cacheStats.searchResults).toBeDefined();
      expect(cacheStats.statistics).toBeDefined();
      expect(cacheStats.memory).toBeDefined();
    });

    it('should allow cache invalidation', () => {
      expect(() => lobbyIntegration.invalidateCache()).not.toThrow();
    });
  });

  describe('broadcasting', () => {
    it('should broadcast room updates', () => {
      const roomSummary = {
        id: 'room123',
        name: 'Test Room',
        userCount: 1,
        owner: 'user123',
        isPrivate: false,
        isHidden: false,
        createdAt: new Date()
      };

      expect(() => {
        lobbyIntegration.broadcastRoomUpdate('created', roomSummary);
      }).not.toThrow();
    });

    it('should broadcast lobby statistics', async () => {
      await expect(lobbyIntegration.broadcastLobbyStatistics()).resolves.toBeUndefined();
    });
  });
});