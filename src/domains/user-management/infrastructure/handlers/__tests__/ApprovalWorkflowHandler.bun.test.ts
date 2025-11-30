import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { ApprovalWorkflowHandler } from '../ApprovalWorkflowHandler';
import { ApprovalSessionManager } from '../../../../../services/ApprovalSessionManager';
import { RoomService } from '../../../../../services/RoomService';
import { NamespaceManager } from '../../../../../services/NamespaceManager';
import { RoomSessionManager, NamespaceSession } from '../../../../../services/RoomSessionManager';
import { Server, Socket, Namespace } from 'socket.io';
import { 
  ApprovalRequestData, 
  ApprovalResponseData, 
  ApprovalCancelData,
  User,
  Room
} from '../../../../../types';

// Mock implementations for Bun testing
class MockSocket {
  public id: string;
  private events: Map<string, any[]> = new Map();

  constructor(id: string = 'mock-socket-id') {
    this.id = id;
  }

  emit(event: string, data?: any): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(data);
  }

  getEmittedEvents(event: string): any[] {
    return this.events.get(event) || [];
  }

  hasEmitted(event: string): boolean {
    return this.events.has(event) && this.events.get(event)!.length > 0;
  }

  disconnect(): void {
    // Mock disconnect
  }
}

class MockNamespace {
  public sockets: Map<string, MockSocket> = new Map();

  emit(event: string, data?: any): void {
    // Mock namespace emit
  }

  addSocket(socket: MockSocket): void {
    this.sockets.set(socket.id, socket);
  }
}

describe('ApprovalWorkflowHandler - Bun Runtime Tests', () => {
  let handler: ApprovalWorkflowHandler;
  let mockRoomService: Partial<RoomService>;
  let mockNamespaceManager: Partial<NamespaceManager>;
  let mockRoomSessionManager: Partial<RoomSessionManager>;
  let mockApprovalSessionManager: ApprovalSessionManager;
  let mockIo: Partial<Server>;

  const createMockRoom = (): Room => ({
    id: 'test-room',
    name: 'Test Room',
    owner: 'owner-id',
    users: new Map(),
    pendingMembers: new Map(),
    isPrivate: true,
    isHidden: false,
    createdAt: new Date(),
      roomType: 'perform' as const,
    metronome: { bpm: 120, lastTickTimestamp: Date.now() }
  });

  const createMockSession = (): NamespaceSession => ({
    roomId: 'test-room',
    userId: 'owner-id',
    socketId: 'owner-socket',
    namespacePath: '/room/test-room',
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  beforeEach(() => {
    // Create mock services
    mockRoomService = {
      getRoom: () => createMockRoom(),
      findUserInRoom: () => undefined,
      addPendingMember: () => {},
      approveMember: () => ({
        id: 'approved-user',
        username: 'approved-user',
        role: 'band_member',
        isReady: false
      } as User),
      rejectMember: () => ({
        id: 'rejected-user',
        username: 'rejected-user',
        role: 'band_member',
        isReady: false
      } as User),
      getRoomUsers: () => [],
      getPendingMembers: () => [],
      isRoomOwner: () => true
    };

    mockNamespaceManager = {
      getRoomNamespace: () => new MockNamespace() as any,
      getApprovalNamespace: () => new MockNamespace() as any
    };

    mockRoomSessionManager = {
      getRoomSession: () => createMockSession()
    };

    mockIo = {};

    // Use real ApprovalSessionManager for timeout testing
    mockApprovalSessionManager = new ApprovalSessionManager();

    handler = new ApprovalWorkflowHandler(
      mockRoomService as RoomService,
      mockIo as Server,
      mockNamespaceManager as NamespaceManager,
      mockRoomSessionManager as RoomSessionManager,
      mockApprovalSessionManager
    );
  });

  afterEach(() => {
    // Clean up any pending timeouts
    mockApprovalSessionManager.cleanup();
  });

  describe('Bun Timer API Tests', () => {
    test('should handle timeout using Bun.nanoseconds() for precise timing', async () => {
      const mockSocket = new MockSocket('bun-timer-socket');
      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockApprovalNamespace.addSocket(mockSocket);

      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'bun-timer-user',
        username: 'bun-timer-user',
        role: 'band_member'
      };

      // Measure performance using Bun's nanosecond timer
      const startTime = Bun.nanoseconds();
      
      handler.handleApprovalRequest(mockSocket as any, requestData, mockApprovalNamespace as any);
      
      const sessionCreationTime = Bun.nanoseconds() - startTime;
      
      // Verify session was created quickly (should be under 5ms = 5,000,000 nanoseconds)
      expect(sessionCreationTime).toBeLessThan(5_000_000);

      // Verify session exists
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('bun-timer-user');
      expect(session).toBeDefined();
      expect(session?.timeoutId).toBeDefined();

      // Test timeout with precise timing
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          const sessionAfterTimeout = mockApprovalSessionManager.getApprovalSessionByUserId('bun-timer-user');
          expect(sessionAfterTimeout).toBeUndefined();
          resolve();
        }, 30100); // Just after 30 second timeout
      });

      await timeoutPromise;
    });

    test('should handle concurrent operations with Bun performance monitoring', async () => {
      const userCount = 50;
      const users = Array.from({ length: userCount }, (_, i) => `perf-user-${i}`);
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));
      const mockApprovalNamespace = new MockNamespace();

      // Measure concurrent request performance
      const startTime = Bun.nanoseconds();

      const concurrentRequests = users.map((userId, index) => {
        return new Promise<void>((resolve) => {
          const requestData: ApprovalRequestData = {
            roomId: 'test-room',
            userId,
            username: userId,
            role: 'band_member'
          };

          // Use Bun's setTimeout for precise timing
          setTimeout(() => {
            handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
            resolve();
          }, Math.random() * 10);
        });
      });

      await Promise.all(concurrentRequests);

      const totalTime = Bun.nanoseconds() - startTime;
      const averageTimePerRequest = totalTime / userCount;

      // Verify performance: each request should average under 500,000 nanoseconds (0.5ms)
      expect(averageTimePerRequest).toBeLessThan(500_000);

      // Verify all sessions were created
      users.forEach(userId => {
        const session = mockApprovalSessionManager.getApprovalSessionByUserId(userId);
        expect(session).toBeDefined();
      });

      // Verify session manager statistics
      const stats = mockApprovalSessionManager.getStats();
      expect(stats.totalSessions).toBe(userCount);
    });

    test('should handle rapid cancellations with Bun concurrent testing', async () => {
      const userCount = 25;
      const users = Array.from({ length: userCount }, (_, i) => `cancel-perf-user-${i}`);
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));
      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      // Create all approval requests first
      users.forEach((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
      });

      // Measure concurrent cancellation performance
      const startTime = Bun.nanoseconds();

      const concurrentCancellations = users.map((userId, index) => {
        return new Promise<void>((resolve) => {
          const cancelData: ApprovalCancelData = {
            userId,
            roomId: 'test-room'
          };

          // Stagger cancellations slightly
          setTimeout(() => {
            handler.handleApprovalCancel(sockets[index] as any, cancelData, mockApprovalNamespace as any);
            resolve();
          }, index); // 0-24ms stagger
        });
      });

      await Promise.all(concurrentCancellations);

      const totalTime = Bun.nanoseconds() - startTime;
      const averageTimePerCancellation = totalTime / userCount;

      // Verify performance: each cancellation should average under 200,000 nanoseconds (0.2ms)
      expect(averageTimePerCancellation).toBeLessThan(200_000);

      // Verify all sessions were cleaned up
      users.forEach(userId => {
        const session = mockApprovalSessionManager.getApprovalSessionByUserId(userId);
        expect(session).toBeUndefined();
      });

      // Verify all cancellation confirmations were sent
      sockets.forEach(socket => {
        expect(socket.hasEmitted('approval_cancelled')).toBe(true);
      });
    });
  });

  describe('Bun Memory and Resource Management', () => {
    test('should handle memory cleanup efficiently with Bun garbage collection hints', async () => {
      const initialMemory = process.memoryUsage();
      
      // Create and destroy many approval sessions
      for (let batch = 0; batch < 10; batch++) {
        const batchUsers = Array.from({ length: 100 }, (_, i) => `memory-test-${batch}-${i}`);
        const batchSockets = batchUsers.map(userId => new MockSocket(`${userId}-socket`));
        const mockApprovalNamespace = new MockNamespace();

        // Create sessions
        batchUsers.forEach((userId, index) => {
          const requestData: ApprovalRequestData = {
            roomId: 'test-room',
            userId,
            username: userId,
            role: 'band_member'
          };

          handler.handleApprovalRequest(batchSockets[index] as any, requestData, mockApprovalNamespace as any);
        });

        // Immediately cancel all sessions
        batchUsers.forEach((userId, index) => {
          const cancelData: ApprovalCancelData = {
            userId,
            roomId: 'test-room'
          };

          handler.handleApprovalCancel(batchSockets[index] as any, cancelData, mockApprovalNamespace as any);
        });

        // Verify cleanup
        batchUsers.forEach(userId => {
          expect(mockApprovalSessionManager.getApprovalSessionByUserId(userId)).toBeUndefined();
        });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be minimal (less than 10MB for 1000 sessions)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    test('should handle resource cleanup on handler destruction', () => {
      const sessionCount = 50;
      const users = Array.from({ length: sessionCount }, (_, i) => `cleanup-user-${i}`);
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));
      const mockApprovalNamespace = new MockNamespace();

      // Create multiple sessions
      users.forEach((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
      });

      // Verify sessions exist
      const stats = mockApprovalSessionManager.getStats();
      expect(stats.totalSessions).toBe(sessionCount);

      // Cleanup all sessions (simulating handler destruction)
      mockApprovalSessionManager.cleanup();

      // Verify all sessions and timeouts were cleaned up
      const finalStats = mockApprovalSessionManager.getStats();
      expect(finalStats.totalSessions).toBe(0);
      expect(finalStats.oldestSessionAge).toBeNull();
    });
  });

  describe('Bun Error Handling and Edge Cases', () => {
    test('should handle malformed data gracefully with Bun error tracking', () => {
      const mockSocket = new MockSocket('error-test-socket');
      const mockApprovalNamespace = new MockNamespace();

      // Test with malformed request data
      const malformedData = {
        roomId: '', // Empty room ID
        userId: null, // Null user ID
        username: undefined, // Undefined username
        role: 'invalid_role' // Invalid role
      } as any;

      // Should not throw error
      expect(() => {
        handler.handleApprovalRequest(mockSocket as any, malformedData, mockApprovalNamespace as any);
      }).not.toThrow();

      // Should emit error to socket
      expect(mockSocket.hasEmitted('approval_error')).toBe(true);
    });

    test('should handle high-frequency operations without performance degradation', async () => {
      const operationCount = 1000;
      const timings: number[] = [];

      for (let i = 0; i < operationCount; i++) {
        const mockSocket = new MockSocket(`freq-test-${i}-socket`);
        const mockApprovalNamespace = new MockNamespace();

        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId: `freq-test-${i}`,
          username: `freq-test-${i}`,
          role: 'band_member'
        };

        const startTime = Bun.nanoseconds();
        handler.handleApprovalRequest(mockSocket as any, requestData, mockApprovalNamespace as any);
        const endTime = Bun.nanoseconds();

        timings.push(endTime - startTime);

        // Immediately cancel to prevent memory buildup
        const cancelData: ApprovalCancelData = {
          userId: `freq-test-${i}`,
          roomId: 'test-room'
        };
        handler.handleApprovalCancel(mockSocket as any, cancelData, mockApprovalNamespace as any);
      }

      // Calculate performance statistics
      const averageTime = timings.reduce((sum, time) => sum + time, 0) / timings.length;
      const maxTime = Math.max(...timings);
      const minTime = Math.min(...timings);

      // Performance should remain consistent (adjusted for realistic expectations)
      expect(averageTime).toBeLessThan(500_000); // Under 0.5ms average
      expect(maxTime).toBeLessThan(5_000_000); // Under 5ms max
      expect(maxTime / minTime).toBeLessThan(50); // Max should not be more than 50x min
    });
  });
});