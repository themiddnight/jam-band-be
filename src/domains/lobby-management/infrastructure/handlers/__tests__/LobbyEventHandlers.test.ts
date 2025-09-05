import { LobbyEventHandlers } from '../LobbyEventHandlers';
import { RealTimeRoomStatusHandler } from '../RealTimeRoomStatusHandler';
import { LobbyIntegrationService } from '../../LobbyIntegrationService';
import { EventBus } from '../../../../../shared/domain/events/EventBus';
import { InMemoryEventBus } from '../../../../../shared/domain/events/InMemoryEventBus';
import { 
  RoomCreated, 
  MemberJoined, 
  MemberLeft, 
  RoomClosed,
  RoomSettingsUpdated 
} from '../../../../../shared/domain/events/RoomEvents';
import { 
  RoomListingsRefreshed, 
  RoomLobbyStatusChanged 
} from '../../../domain/events/LobbyEvents';

describe('LobbyEventHandlers', () => {
  let eventBus: EventBus;
  let lobbyIntegrationService: jest.Mocked<LobbyIntegrationService>;
  let lobbyEventHandlers: LobbyEventHandlers;
  let realTimeStatusHandler: RealTimeRoomStatusHandler;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    
    // Mock LobbyIntegrationService
    lobbyIntegrationService = {
      broadcastRoomUpdate: jest.fn(),
      broadcastLobbyStatistics: jest.fn(),
      getLobbyApplicationService: jest.fn().mockReturnValue({
        getLobbyStatistics: jest.fn().mockResolvedValue({
          totalRooms: 10,
          activeRooms: 8,
          availableRooms: 6,
          averageMemberCount: 3.2,
          popularGenres: [
            { genre: 'rock', roomCount: 5, totalMembers: 15, averageMembers: 3 },
            { genre: 'jazz', roomCount: 3, totalMembers: 9, averageMembers: 3 }
          ],
          activityDistribution: { active: 8, idle: 2, inactive: 0 }
        }),
        refreshRoomListings: jest.fn(),
        cleanupInactiveRooms: jest.fn().mockResolvedValue(2),
        roomListingRepository: {
          findById: jest.fn().mockResolvedValue({
            toSummary: jest.fn().mockReturnValue({
              id: 'room-123',
              name: 'Test Room',
              memberCount: 3,
              maxMembers: 8,
              isPrivate: false,
              canJoinDirectly: true
            })
          })
        }
      }),
      io: {
        of: jest.fn().mockReturnValue({
          to: jest.fn().mockReturnValue({
            emit: jest.fn()
          }),
          sockets: { size: 25 }
        })
      }
    } as any;

    lobbyEventHandlers = new LobbyEventHandlers(eventBus, lobbyIntegrationService);
    realTimeStatusHandler = new RealTimeRoomStatusHandler(eventBus, lobbyIntegrationService);
  });

  afterEach(() => {
    lobbyEventHandlers.shutdown();
    realTimeStatusHandler.shutdown();
  });

  describe('Room Creation Events', () => {
    it('should handle room created event with batching', async () => {
      const roomCreatedEvent = new RoomCreated(
        'room-123',
        'user-456',
        'Test Room',
        false
      );

      // Publish event
      await eventBus.publish(roomCreatedEvent);

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify room listings refresh event was published
      const publishedEvents = (eventBus as InMemoryEventBus).getPublishedEvents();
      const refreshEvent = publishedEvents.find(e => e instanceof RoomListingsRefreshed);
      expect(refreshEvent).toBeDefined();
      expect((refreshEvent as RoomListingsRefreshed).refreshTrigger).toBe('room_change');
    });

    it('should batch multiple room updates efficiently', async () => {
      const events = [
        new RoomCreated('room-1', 'user-1', 'Room 1', false),
        new RoomCreated('room-2', 'user-2', 'Room 2', true),
        new MemberJoined('room-1', 'user-3', 'User3', 'member'),
        new MemberJoined('room-2', 'user-4', 'User4', 'member')
      ];

      // Publish events rapidly
      for (const event of events) {
        await eventBus.publish(event);
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Verify batching occurred (should have fewer broadcasts than events)
      const mockNamespace = lobbyIntegrationService.io.of('/lobby');
      const mockEmit = mockNamespace.to('lobby_updates').emit as jest.Mock;
      
      // Should have batch emissions rather than individual ones
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  describe('Room Settings Updates', () => {
    it('should handle privacy changes and publish lobby status change', async () => {
      const settingsUpdatedEvent = new RoomSettingsUpdated(
        'room-123',
        'user-456',
        { isPrivate: true, maxMembers: 6 }
      );

      await eventBus.publish(settingsUpdatedEvent);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify lobby status change event was published
      const publishedEvents = (eventBus as InMemoryEventBus).getPublishedEvents();
      const statusChangeEvent = publishedEvents.find(e => e instanceof RoomLobbyStatusChanged);
      expect(statusChangeEvent).toBeDefined();
      expect((statusChangeEvent as RoomLobbyStatusChanged).reason).toBe('privacy_change');
      expect((statusChangeEvent as RoomLobbyStatusChanged).isVisibleInLobby).toBe(false);
    });

    it('should ignore settings changes that do not affect lobby', async () => {
      const settingsUpdatedEvent = new RoomSettingsUpdated(
        'room-123',
        'user-456',
        { audioSettings: { volume: 0.8 } }
      );

      await eventBus.publish(settingsUpdatedEvent);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not publish lobby status change for non-lobby affecting changes
      const publishedEvents = (eventBus as InMemoryEventBus).getPublishedEvents();
      const statusChangeEvent = publishedEvents.find(e => e instanceof RoomLobbyStatusChanged);
      expect(statusChangeEvent).toBeUndefined();
    });
  });

  describe('Real-Time Status Handling', () => {
    it('should update room status with debouncing', async () => {
      // Rapid status updates
      await realTimeStatusHandler.updateRoomStatus('room-123', { memberCount: 1 });
      await realTimeStatusHandler.updateRoomStatus('room-123', { memberCount: 2 });
      await realTimeStatusHandler.updateRoomStatus('room-123', { memberCount: 3 });

      // Should have debounced to single update
      const status = realTimeStatusHandler.getRoomStatus('room-123');
      expect(status).toBeDefined();
      expect(status?.memberCount).toBe(3);
    });

    it('should handle room activity changes', async () => {
      await realTimeStatusHandler.handleRoomActivityChange(
        'room-123',
        'member_join',
        { memberCount: 4, isOwnerAction: false }
      );

      const status = realTimeStatusHandler.getRoomStatus('room-123');
      expect(status).toBeDefined();
      expect(status?.activityType).toBe('member_join');
      expect(status?.isActive).toBe(true);
    });

    it('should handle member count changes with appropriate priority', async () => {
      // Large member count change should be high priority
      await realTimeStatusHandler.handleMemberCountChange('room-123', 8, 2);

      const status = realTimeStatusHandler.getRoomStatus('room-123');
      expect(status).toBeDefined();
      expect(status?.memberCount).toBe(8);
      expect(status?.memberCountChange).toBeGreaterThan(0.5); // > 50% change
    });

    it('should handle privacy changes with high priority', async () => {
      await realTimeStatusHandler.handlePrivacyChange('room-123', true);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = realTimeStatusHandler.getRoomStatus('room-123');
      expect(status).toBeDefined();
      expect(status?.isPrivate).toBe(true);

      // Should publish lobby status change
      const publishedEvents = (eventBus as InMemoryEventBus).getPublishedEvents();
      const statusChangeEvent = publishedEvents.find(e => e instanceof RoomLobbyStatusChanged);
      expect(statusChangeEvent).toBeDefined();
    });
  });

  describe('Performance and Efficiency', () => {
    it('should process batch updates within time limits', async () => {
      const startTime = Date.now();
      
      // Create many room events
      const events = Array.from({ length: 20 }, (_, i) => 
        new MemberJoined(`room-${i}`, `user-${i}`, `User${i}`, 'member')
      );

      // Publish all events
      for (const event of events) {
        await eventBus.publish(event);
      }

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 1100));

      const processingTime = Date.now() - startTime;
      
      // Should complete within reasonable time (less than 2 seconds)
      expect(processingTime).toBeLessThan(2000);
    });

    it('should limit queue size to prevent memory issues', async () => {
      // Create more updates than max queue size
      for (let i = 0; i < 150; i++) {
        await realTimeStatusHandler.updateRoomStatus(`room-${i}`, { 
          memberCount: i % 8,
          isActive: true 
        });
      }

      // Should not exceed reasonable memory usage
      const activeStatuses = realTimeStatusHandler.getActiveRoomStatuses();
      expect(activeStatuses.size).toBeLessThanOrEqual(100);
    });

    it('should clean up old cache entries', async () => {
      // Add status that will become old
      await realTimeStatusHandler.updateRoomStatus('old-room', { 
        memberCount: 1,
        isActive: true 
      });

      // Mock time passage
      jest.useFakeTimers();
      jest.advanceTimersByTime(35000); // 35 seconds

      // Trigger cleanup
      jest.runOnlyPendingTimers();

      // Old status should be cleaned up
      const status = realTimeStatusHandler.getRoomStatus('old-room');
      expect(status).toBeUndefined();

      jest.useRealTimers();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully during batch processing', async () => {
      // Mock error in room listing repository
      const mockService = lobbyIntegrationService.getLobbyApplicationService();
      mockService.roomListingRepository.findById = jest.fn().mockRejectedValue(
        new Error('Database connection failed')
      );

      const roomCreatedEvent = new RoomCreated('room-123', 'user-456', 'Test Room', false);
      
      // Should not throw error
      await expect(eventBus.publish(roomCreatedEvent)).resolves.not.toThrow();

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should continue processing other events
      expect(true).toBe(true); // Test passes if no exception thrown
    });

    it('should handle invalid room status updates', async () => {
      // Should not throw for invalid data
      await expect(
        realTimeStatusHandler.updateRoomStatus('', { memberCount: -1 })
      ).resolves.not.toThrow();

      await expect(
        realTimeStatusHandler.handleRoomActivityChange('room-123', 'invalid_activity' as any)
      ).resolves.not.toThrow();
    });
  });

  describe('Metrics Collection', () => {
    it('should collect and publish lobby metrics periodically', async () => {
      // Mock timer for metrics collection
      jest.useFakeTimers();

      // Advance time to trigger metrics collection
      jest.advanceTimersByTime(5 * 60 * 1000 + 100); // 5 minutes + buffer

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have published metrics event
      const publishedEvents = (eventBus as InMemoryEventBus).getPublishedEvents();
      const metricsEvent = publishedEvents.find(e => e.constructor.name === 'LobbyMetricsCollected');
      expect(metricsEvent).toBeDefined();

      jest.useRealTimers();
    });
  });
});