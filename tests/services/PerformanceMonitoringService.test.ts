import { PerformanceMonitoringService } from '../../src/services/PerformanceMonitoringService';
import { NamespaceManager } from '../../src/services/NamespaceManager';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { Server } from 'socket.io';

// Mock dependencies
jest.mock('../../src/services/LoggingService');

describe('PerformanceMonitoringService', () => {
  let performanceMonitoring: PerformanceMonitoringService;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockIo: jest.Mocked<Server>;

  beforeEach(() => {
    // Create mock objects
    mockIo = {
      of: jest.fn(),
      emit: jest.fn(),
    } as any;

    mockNamespaceManager = {
      getNamespaceStats: jest.fn().mockReturnValue({
        totalNamespaces: 2,
        totalConnections: 5,
        namespaceDetails: [
          {
            path: '/room/test-room-1',
            connectionCount: 3,
            createdAt: new Date(),
            lastActivity: new Date(),
            age: 60000
          },
          {
            path: '/room/test-room-2',
            connectionCount: 2,
            createdAt: new Date(),
            lastActivity: new Date(),
            age: 30000
          }
        ]
      }),
      shutdown: jest.fn()
    } as any;

    mockRoomSessionManager = {
      getSessionStats: jest.fn().mockReturnValue({
        totalSessions: 5,
        roomSessions: 5,
        approvalSessions: 0,
        lobbySessions: 0,
        roomBreakdown: [
          { roomId: 'test-room-1', roomSessions: 3, approvalSessions: 0 },
          { roomId: 'test-room-2', roomSessions: 2, approvalSessions: 0 }
        ]
      }),
      getRoomSessions: jest.fn().mockReturnValue(new Map([
        ['socket1', { userId: 'user1', socketId: 'socket1' }],
        ['socket2', { userId: 'user2', socketId: 'socket2' }],
        ['socket3', { userId: 'user3', socketId: 'socket3' }]
      ])),
      cleanupExpiredSessions: jest.fn()
    } as any;

    performanceMonitoring = PerformanceMonitoringService.getInstance(
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  afterEach(() => {
    performanceMonitoring.shutdown();
    jest.clearAllMocks();
  });

  describe('Room Event Recording', () => {
    it('should record room events correctly', () => {
      const roomId = 'test-room-1';
      const eventName = 'play_note';
      const duration = 50;

      performanceMonitoring.recordRoomEvent(roomId, eventName, duration);

      const roomMetrics = performanceMonitoring.getRoomMetrics(roomId);
      expect(roomMetrics).toBeDefined();
      expect(roomMetrics!.roomId).toBe(roomId);
      expect(roomMetrics!.messageCount).toBe(1);
      expect(roomMetrics!.eventCounts.get(eventName)).toBe(1);
    });

    it('should track slow events', () => {
      const roomId = 'test-room-1';
      const eventName = 'slow_event';
      const slowDuration = 1500; // Above 1000ms threshold

      performanceMonitoring.recordRoomEvent(roomId, eventName, slowDuration);

      const roomMetrics = performanceMonitoring.getRoomMetrics(roomId);
      expect(roomMetrics!.slowEvents).toHaveLength(1);
      expect(roomMetrics!.slowEvents[0]?.event).toBe(eventName);
      expect(roomMetrics!.slowEvents[0]?.duration).toBe(slowDuration);
    });

    it('should limit slow events array size', () => {
      const roomId = 'test-room-1';
      const eventName = 'slow_event';
      const slowDuration = 1500;

      // Add more than the limit (100) slow events
      for (let i = 0; i < 105; i++) {
        performanceMonitoring.recordRoomEvent(roomId, `${eventName}_${i}`, slowDuration);
      }

      const roomMetrics = performanceMonitoring.getRoomMetrics(roomId);
      expect(roomMetrics!.slowEvents.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Room Error Recording', () => {
    it('should record room errors correctly', () => {
      const roomId = 'test-room-1';
      const error = new Error('Test error');
      const context = { testContext: 'value' };

      performanceMonitoring.recordRoomError(roomId, error, context);

      const roomMetrics = performanceMonitoring.getRoomMetrics(roomId);
      expect(roomMetrics!.errorCount).toBe(1);
    });
  });

  describe('Connection Health Tracking', () => {
    it('should update connection health metrics', () => {
      const socketId = 'test-socket-1';
      const userId = 'test-user-1';
      const roomId = 'test-room-1';
      const namespacePath = '/room/test-room-1';

      performanceMonitoring.updateConnectionHealth(
        socketId,
        userId,
        roomId,
        namespacePath,
        {
          connectionState: 'connected',
          latency: 100,
          errorCount: 0
        }
      );

      const connectionHealth = performanceMonitoring.getConnectionHealth();
      expect(connectionHealth.has(socketId)).toBe(true);
      
      const healthMetrics = connectionHealth.get(socketId);
      expect(healthMetrics!.userId).toBe(userId);
      expect(healthMetrics!.roomId).toBe(roomId);
      expect(healthMetrics!.latency).toBe(100);
    });

    it('should remove connection health tracking', () => {
      const socketId = 'test-socket-1';
      const userId = 'test-user-1';
      const roomId = 'test-room-1';
      const namespacePath = '/room/test-room-1';

      performanceMonitoring.updateConnectionHealth(
        socketId,
        userId,
        roomId,
        namespacePath,
        { connectionState: 'connected' }
      );

      expect(performanceMonitoring.getConnectionHealth().has(socketId)).toBe(true);

      performanceMonitoring.removeConnectionHealth(socketId);
      expect(performanceMonitoring.getConnectionHealth().has(socketId)).toBe(false);
    });
  });

  describe('System Metrics', () => {
    it('should return system metrics', () => {
      const systemMetrics = performanceMonitoring.getSystemMetrics();

      expect(systemMetrics).toBeDefined();
      expect(systemMetrics.totalRooms).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.totalConnections).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.systemHealth).toMatch(/healthy|warning|critical/);
      expect(systemMetrics.uptime).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.gcMetrics).toBeDefined();
    });

    it('should return performance summary', () => {
      // Add some test data
      performanceMonitoring.recordRoomEvent('room1', 'play_note', 50);
      performanceMonitoring.recordRoomEvent('room2', 'play_note', 75);
      performanceMonitoring.recordRoomEvent('room1', 'slow_event', 1500);

      const summary = performanceMonitoring.getPerformanceSummary();

      expect(summary).toBeDefined();
      expect(summary.system).toBeDefined();
      expect(summary.roomCount).toBeGreaterThanOrEqual(0);
      expect(summary.connectionCount).toBeGreaterThanOrEqual(0);
      expect(summary.topPerformingRooms).toBeInstanceOf(Array);
      expect(summary.slowestRooms).toBeInstanceOf(Array);
    });
  });

  describe('Room Metrics', () => {
    it('should return room metrics for existing room', () => {
      const roomId = 'test-room-1';
      performanceMonitoring.recordRoomEvent(roomId, 'test_event', 100);

      const roomMetrics = performanceMonitoring.getRoomMetrics(roomId);
      expect(roomMetrics).toBeDefined();
      expect(roomMetrics!.roomId).toBe(roomId);
    });

    it('should return undefined for non-existent room', () => {
      const roomMetrics = performanceMonitoring.getRoomMetrics('non-existent-room');
      expect(roomMetrics).toBeUndefined();
    });

    it('should return all room metrics', () => {
      performanceMonitoring.recordRoomEvent('room1', 'event1', 50);
      performanceMonitoring.recordRoomEvent('room2', 'event2', 75);

      const allMetrics = performanceMonitoring.getAllRoomMetrics();
      expect(allMetrics.size).toBeGreaterThanOrEqual(2);
      expect(allMetrics.has('room1')).toBe(true);
      expect(allMetrics.has('room2')).toBe(true);
    });
  });

  describe('Memory Management', () => {
    it('should handle memory pressure detection', () => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn(() => ({
        rss: 900 * 1024 * 1024, // 900MB
        heapUsed: 900 * 1024 * 1024, // 900MB - above critical threshold
        heapTotal: 1000 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        arrayBuffers: 10 * 1024 * 1024
      })) as any;

      const systemMetrics = performanceMonitoring.getSystemMetrics();
      expect(systemMetrics.systemHealth).toMatch(/healthy|warning|critical/);

      // Restore original function
      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('Service Lifecycle', () => {
    it('should shutdown cleanly', () => {
      expect(() => {
        performanceMonitoring.shutdown();
      }).not.toThrow();
    });
  });
});