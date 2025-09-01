import { ApprovalWorkflowHandler } from '../../domains/user-management/infrastructure/handlers/ApprovalWorkflowHandler';
import { ApprovalSessionManager } from '../../services/ApprovalSessionManager';
import { RoomService } from '../../services/RoomService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager, NamespaceSession } from '../../services/RoomSessionManager';
import { Server, Socket, Namespace } from 'socket.io';
import { 
  ApprovalRequestData, 
  ApprovalResponseData, 
  ApprovalCancelData,
  User,
  Room
} from '../../types';

// Mock implementations
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

describe('ApprovalWorkflowHandler - Edge Cases', () => {
  let handler: ApprovalWorkflowHandler;
  let mockRoomService: jest.Mocked<RoomService>;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockApprovalSessionManager: ApprovalSessionManager;
  let mockIo: jest.Mocked<Server>;

  const createMockRoom = (): Room => ({
    id: 'test-room',
    name: 'Test Room',
    owner: 'owner-id',
    users: new Map(),
    pendingMembers: new Map(),
    isPrivate: true,
    isHidden: false,
    createdAt: new Date(),
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
      getRoom: jest.fn(),
      findUserInRoom: jest.fn(),
      addPendingMember: jest.fn(),
      approveMember: jest.fn(),
      rejectMember: jest.fn(),
      getRoomUsers: jest.fn(),
      getPendingMembers: jest.fn(),
      isRoomOwner: jest.fn()
    } as any;

    mockNamespaceManager = {
      getRoomNamespace: jest.fn(),
      getApprovalNamespace: jest.fn()
    } as any;

    mockRoomSessionManager = {
      getRoomSession: jest.fn()
    } as any;

    mockIo = {} as any;

    // Use real ApprovalSessionManager for timeout testing
    mockApprovalSessionManager = new ApprovalSessionManager();

    handler = new ApprovalWorkflowHandler(
      mockRoomService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager,
      mockApprovalSessionManager
    );
  });

  afterEach(() => {
    // Clean up any pending timeouts
    mockApprovalSessionManager.cleanup();
  });

  describe('Timeout Scenarios', () => {
    it('should handle approval timeout automatically', async () => {
      // Setup mock room
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockSocket = new MockSocket('requester-socket');
      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockApprovalNamespace.addSocket(mockSocket);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      // Use fake timers before creating the session
      jest.useFakeTimers();

      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'requester-id',
        username: 'requester',
        role: 'band_member'
      };

      // Create approval request
      handler.handleApprovalRequest(mockSocket as any, requestData, mockApprovalNamespace as any);

      // Verify session was created
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('requester-id');
      expect(session).toBeDefined();
      expect(session?.timeoutId).toBeDefined();

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(30000);

      // Run all pending timers
      jest.runAllTimers();

      // Verify session was cleaned up after timeout
      const sessionAfterTimeout = mockApprovalSessionManager.getApprovalSessionByUserId('requester-id');
      expect(sessionAfterTimeout).toBeUndefined();

      // Verify room service was called to reject member
      expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', 'requester-id');

      jest.useRealTimers();
    });

    it('should handle timeout with precise timing using Bun timer APIs', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockSocket = new MockSocket('precise-timer-socket');
      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockApprovalNamespace.addSocket(mockSocket);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      jest.useFakeTimers();

      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'precise-timer-user',
        username: 'precise-timer-user',
        role: 'band_member'
      };

      // Record start time
      const startTime = Date.now();
      handler.handleApprovalRequest(mockSocket as any, requestData, mockApprovalNamespace as any);

      // Verify session exists
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('precise-timer-user');
      expect(session).toBeDefined();

      // Test timeout at exactly 30 seconds (30000ms)
      jest.advanceTimersByTime(29999);
      
      // Session should still exist
      const sessionBeforeTimeout = mockApprovalSessionManager.getApprovalSessionByUserId('precise-timer-user');
      expect(sessionBeforeTimeout).toBeDefined();

      // Advance by 1ms to trigger timeout
      jest.advanceTimersByTime(1);
      jest.runAllTimers();

      // Session should be cleaned up
      const sessionAfterTimeout = mockApprovalSessionManager.getApprovalSessionByUserId('precise-timer-user');
      expect(sessionAfterTimeout).toBeUndefined();

      jest.useRealTimers();
    });

    it('should handle timeout edge case at exactly timeout boundary', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockSocket = new MockSocket('boundary-socket');
      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockApprovalNamespace.addSocket(mockSocket);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      jest.useFakeTimers();

      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'boundary-user',
        username: 'boundary-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(mockSocket as any, requestData, mockApprovalNamespace as any);

      // Test multiple boundary conditions
      const timeoutMs = mockApprovalSessionManager.getApprovalTimeoutMs();
      
      // Just before timeout
      jest.advanceTimersByTime(timeoutMs - 1);
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('boundary-user')).toBeDefined();

      // Exactly at timeout
      jest.advanceTimersByTime(1);
      jest.runAllTimers();
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('boundary-user')).toBeUndefined();

      jest.useRealTimers();
    });

    it('should handle multiple timeouts concurrently', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      // Use fake timers before creating sessions
      jest.useFakeTimers();

      // Create multiple approval requests
      const users = ['user1', 'user2', 'user3'];
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));

      // Add sockets to namespace
      sockets.forEach(socket => mockApprovalNamespace.addSocket(socket));

      users.forEach((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
      });

      // Verify all sessions were created
      users.forEach(userId => {
        const session = mockApprovalSessionManager.getApprovalSessionByUserId(userId);
        expect(session).toBeDefined();
      });

      // Fast-forward time to trigger all timeouts
      jest.advanceTimersByTime(30000);
      jest.runAllTimers();

      // Verify all sessions were cleaned up
      users.forEach(userId => {
        const session = mockApprovalSessionManager.getApprovalSessionByUserId(userId);
        expect(session).toBeUndefined();
      });

      // Verify room service was called for each user
      users.forEach(userId => {
        expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', userId);
      });

      jest.useRealTimers();
    });

    it('should clear timeout when approval is granted before timeout', async () => {
      const mockRoom = createMockRoom();
      const mockUser: User = {
        id: 'approved-user',
        username: 'approved-user',
        role: 'band_member',
        isReady: false
      };

      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);
      mockRoomService.approveMember.mockReturnValue(mockUser);
      mockRoomService.getRoomUsers.mockReturnValue([]);
      mockRoomService.getPendingMembers.mockReturnValue([]);
      mockRoomService.isRoomOwner.mockReturnValue(true);

      const mockSession = createMockSession();
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('requester-socket');
      const ownerSocket = new MockSocket('owner-socket');

      mockApprovalNamespace.addSocket(requesterSocket);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'approved-user',
        username: 'approved-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      // Verify session was created with timeout
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('approved-user');
      expect(session).toBeDefined();
      expect(session?.timeoutId).toBeDefined();

      jest.useFakeTimers();

      // Approve the user before timeout
      const responseData: ApprovalResponseData = {
        userId: 'approved-user',
        approved: true
      };

      handler.handleApprovalResponse(ownerSocket as any, responseData, mockRoomNamespace as any);

      // Verify session was cleaned up immediately
      const sessionAfterApproval = mockApprovalSessionManager.getApprovalSessionByUserId('approved-user');
      expect(sessionAfterApproval).toBeUndefined();

      // Fast-forward time past original timeout
      jest.advanceTimersByTime(30000);

      // Verify no additional cleanup occurred (no double rejection)
      expect(mockRoomService.rejectMember).not.toHaveBeenCalled();
      expect(mockRoomService.approveMember).toHaveBeenCalledWith('test-room', 'approved-user');

      jest.useRealTimers();
    });
  });

  describe('Approval Cancellation', () => {
    it('should handle user cancelling their own approval request', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('requester-socket');

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Create approval request first
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'cancelling-user',
        username: 'cancelling-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      // Verify session exists
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('cancelling-user');
      expect(session).toBeDefined();

      // Cancel the request
      const cancelData: ApprovalCancelData = {
        userId: 'cancelling-user',
        roomId: 'test-room'
      };

      handler.handleApprovalCancel(requesterSocket as any, cancelData, mockApprovalNamespace as any);

      // Verify session was cleaned up
      const sessionAfterCancel = mockApprovalSessionManager.getApprovalSessionByUserId('cancelling-user');
      expect(sessionAfterCancel).toBeUndefined();

      // Verify room service was called to reject member
      expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', 'cancelling-user');

      // Verify user was notified of cancellation
      expect(requesterSocket.hasEmitted('approval_cancelled')).toBe(true);
    });

    it('should prevent cancellation of non-existent approval session', () => {
      const requesterSocket = new MockSocket('requester-socket');
      const mockApprovalNamespace = new MockNamespace();

      const cancelData: ApprovalCancelData = {
        userId: 'non-existent-user',
        roomId: 'test-room'
      };

      handler.handleApprovalCancel(requesterSocket as any, cancelData, mockApprovalNamespace as any);

      // Verify error was emitted
      expect(requesterSocket.hasEmitted('approval_error')).toBe(true);
      const errorEvents = requesterSocket.getEmittedEvents('approval_error');
      expect(errorEvents[0]).toEqual({ message: 'No approval session found' });
    });

    it('should prevent cancellation with mismatched session data', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('requester-socket');

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'legitimate-user',
        username: 'legitimate-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      // Try to cancel with wrong user ID
      const cancelData: ApprovalCancelData = {
        userId: 'wrong-user',
        roomId: 'test-room'
      };

      handler.handleApprovalCancel(requesterSocket as any, cancelData, mockApprovalNamespace as any);

      // Verify error was emitted
      expect(requesterSocket.hasEmitted('approval_error')).toBe(true);
      const errorEvents = requesterSocket.getEmittedEvents('approval_error');
      expect(errorEvents[0]).toEqual({ message: 'Invalid cancellation request' });

      // Verify session still exists
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('legitimate-user');
      expect(session).toBeDefined();
    });

    it('should handle cancellation with wrong room ID', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('requester-socket');

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'room-mismatch-user',
        username: 'room-mismatch-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      // Try to cancel with wrong room ID
      const cancelData: ApprovalCancelData = {
        userId: 'room-mismatch-user',
        roomId: 'wrong-room'
      };

      handler.handleApprovalCancel(requesterSocket as any, cancelData, mockApprovalNamespace as any);

      // Verify error was emitted
      expect(requesterSocket.hasEmitted('approval_error')).toBe(true);
      const errorEvents = requesterSocket.getEmittedEvents('approval_error');
      expect(errorEvents[0]).toEqual({ message: 'Invalid cancellation request' });

      // Verify session still exists
      const session = mockApprovalSessionManager.getApprovalSessionByUserId('room-mismatch-user');
      expect(session).toBeDefined();
    });

    it('should handle rapid cancellation attempts', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('rapid-cancel-socket');

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'rapid-cancel-user',
        username: 'rapid-cancel-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      const cancelData: ApprovalCancelData = {
        userId: 'rapid-cancel-user',
        roomId: 'test-room'
      };

      // First cancellation should succeed
      handler.handleApprovalCancel(requesterSocket as any, cancelData, mockApprovalNamespace as any);
      expect(requesterSocket.hasEmitted('approval_cancelled')).toBe(true);

      // Second cancellation should fail (session no longer exists)
      const secondSocket = new MockSocket('second-cancel-socket');
      handler.handleApprovalCancel(secondSocket as any, cancelData, mockApprovalNamespace as any);
      expect(secondSocket.hasEmitted('approval_error')).toBe(true);
      
      const errorEvents = secondSocket.getEmittedEvents('approval_error');
      expect(errorEvents[0]).toEqual({ message: 'No approval session found' });
    });
  });

  describe('Concurrent Approval Requests', () => {
    it('should handle multiple users requesting approval for the same room simultaneously', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Create multiple concurrent approval requests
      const users = ['user1', 'user2', 'user3', 'user4', 'user5'];
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));

      // Submit all requests concurrently
      const requests = users.map((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        return () => handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
      });

      // Execute all requests simultaneously
      requests.forEach(request => request());

      // Verify all sessions were created
      users.forEach(userId => {
        const session = mockApprovalSessionManager.getApprovalSessionByUserId(userId);
        expect(session).toBeDefined();
        expect(session?.roomId).toBe('test-room');
      });

      // Verify all users were added as pending members
      expect(mockRoomService.addPendingMember).toHaveBeenCalledTimes(users.length);

      // Verify all sockets received pending confirmation
      sockets.forEach(socket => {
        expect(socket.hasEmitted('approval_pending')).toBe(true);
      });
    });

    it('should handle high-concurrency approval requests with Bun concurrent testing', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Test with higher concurrency (20 users)
      const userCount = 20;
      const users = Array.from({ length: userCount }, (_, i) => `concurrent-user-${i}`);
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));

      // Create concurrent promises for all requests
      const concurrentRequests = users.map((userId, index) => {
        return new Promise<void>((resolve) => {
          const requestData: ApprovalRequestData = {
            roomId: 'test-room',
            userId,
            username: userId,
            role: 'band_member'
          };

          // Simulate slight timing variations
          setTimeout(() => {
            handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
            resolve();
          }, Math.random() * 10); // Random delay 0-10ms
        });
      });

      // Execute all requests concurrently
      await Promise.all(concurrentRequests);

      // Verify all sessions were created successfully
      users.forEach(userId => {
        const session = mockApprovalSessionManager.getApprovalSessionByUserId(userId);
        expect(session).toBeDefined();
        expect(session?.roomId).toBe('test-room');
      });

      // Verify session manager statistics
      const stats = mockApprovalSessionManager.getStats();
      expect(stats.totalSessions).toBe(userCount);
      expect(stats.sessionsByRoom['test-room']).toBe(userCount);
    });

    it('should handle concurrent approval and cancellation operations', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Create approval requests
      const users = ['cancel-user-1', 'cancel-user-2', 'cancel-user-3'];
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));

      // Submit approval requests
      users.forEach((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
      });

      // Verify all sessions exist
      users.forEach(userId => {
        expect(mockApprovalSessionManager.getApprovalSessionByUserId(userId)).toBeDefined();
      });

      // Concurrently cancel all requests
      const concurrentCancellations = users.map((userId, index) => {
        return new Promise<void>((resolve) => {
          const cancelData: ApprovalCancelData = {
            userId,
            roomId: 'test-room'
          };

          setTimeout(() => {
            handler.handleApprovalCancel(sockets[index] as any, cancelData, mockApprovalNamespace as any);
            resolve();
          }, Math.random() * 5); // Random delay 0-5ms
        });
      });

      await Promise.all(concurrentCancellations);

      // Verify all sessions were cleaned up
      users.forEach(userId => {
        expect(mockApprovalSessionManager.getApprovalSessionByUserId(userId)).toBeUndefined();
      });

      // Verify all cancellation confirmations were sent
      sockets.forEach(socket => {
        expect(socket.hasEmitted('approval_cancelled')).toBe(true);
      });
    });

    it('should prevent duplicate approval requests from the same user', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('requester-socket');

      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'duplicate-user',
        username: 'duplicate-user',
        role: 'band_member'
      };

      // First request should succeed
      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);
      expect(requesterSocket.hasEmitted('approval_pending')).toBe(true);

      // Second request should fail
      const secondSocket = new MockSocket('second-socket');
      handler.handleApprovalRequest(secondSocket as any, requestData, mockApprovalNamespace as any);

      // Verify error was emitted for duplicate request
      expect(secondSocket.hasEmitted('approval_error')).toBe(true);
      const errorEvents = secondSocket.getEmittedEvents('approval_error');
      expect(errorEvents[0]).toEqual({ message: 'You already have a pending approval request' });

      // Verify only one session exists
      const sessions = mockApprovalSessionManager.getApprovalSessionsForRoom('test-room');
      expect(sessions).toHaveLength(1);
    });

    it('should handle concurrent approval responses for multiple users', () => {
      const mockRoom = createMockRoom();
      const approvedUser: User = {
        id: 'user1',
        username: 'user1',
        role: 'band_member',
        isReady: false
      };

      const rejectedUser: User = {
        id: 'user2',
        username: 'user2',
        role: 'band_member',
        isReady: false
      };

      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);
      mockRoomService.isRoomOwner.mockReturnValue(true);
      mockRoomService.approveMember.mockReturnValue(approvedUser);
      mockRoomService.rejectMember.mockReturnValue(rejectedUser);
      mockRoomService.getRoomUsers.mockReturnValue([]);
      mockRoomService.getPendingMembers.mockReturnValue([]);

      const mockSession = createMockSession();
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const ownerSocket = new MockSocket('owner-socket');

      // Create approval sessions for multiple users
      const user1Socket = new MockSocket('user1-socket');
      const user2Socket = new MockSocket('user2-socket');

      mockApprovalNamespace.addSocket(user1Socket);
      mockApprovalNamespace.addSocket(user2Socket);

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      // Create approval requests
      ['user1', 'user2'].forEach((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        const socket = index === 0 ? user1Socket : user2Socket;
        handler.handleApprovalRequest(socket as any, requestData, mockApprovalNamespace as any);
      });

      // Process concurrent approval responses
      const approveResponse: ApprovalResponseData = {
        userId: 'user1',
        approved: true
      };

      const rejectResponse: ApprovalResponseData = {
        userId: 'user2',
        approved: false,
        message: 'Room is full'
      };

      // Handle both responses
      handler.handleApprovalResponse(ownerSocket as any, approveResponse, mockRoomNamespace as any);
      handler.handleApprovalResponse(ownerSocket as any, rejectResponse, mockRoomNamespace as any);

      // Verify both sessions were cleaned up
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('user1')).toBeUndefined();
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('user2')).toBeUndefined();

      // Verify appropriate service calls were made
      expect(mockRoomService.approveMember).toHaveBeenCalledWith('test-room', 'user1');
      expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', 'user2');

      // Verify owner received success confirmations
      const successEvents = ownerSocket.getEmittedEvents('approval_success');
      expect(successEvents).toHaveLength(2);
    });

    it('should handle race condition between timeout and manual response', async () => {
      const mockRoom = createMockRoom();
      const approvedUser: User = {
        id: 'race-user',
        username: 'race-user',
        role: 'band_member',
        isReady: false
      };

      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);
      mockRoomService.isRoomOwner.mockReturnValue(true);
      mockRoomService.approveMember.mockReturnValue(approvedUser);
      mockRoomService.getRoomUsers.mockReturnValue([]);
      mockRoomService.getPendingMembers.mockReturnValue([]);

      const mockSession = createMockSession();
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('requester-socket');
      const ownerSocket = new MockSocket('owner-socket');

      mockApprovalNamespace.addSocket(requesterSocket);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);
      mockNamespaceManager.getApprovalNamespace.mockReturnValue(mockApprovalNamespace as any);

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'race-user',
        username: 'race-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      jest.useFakeTimers();

      // Simulate race condition: approval response arrives just before timeout
      setTimeout(() => {
        const approveResponse: ApprovalResponseData = {
          userId: 'race-user',
          approved: true
        };
        handler.handleApprovalResponse(ownerSocket as any, approveResponse, mockRoomNamespace as any);
      }, 29999); // Just before 30 second timeout

      // Advance time to just before timeout
      jest.advanceTimersByTime(29999);

      // Verify session was cleaned up by approval response
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('race-user')).toBeUndefined();

      // Advance past timeout
      jest.advanceTimersByTime(2);

      // Verify no double processing occurred
      expect(mockRoomService.approveMember).toHaveBeenCalledTimes(1);
      expect(mockRoomService.rejectMember).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Complex Edge Cases and Race Conditions', () => {
    it('should handle timeout vs cancellation race condition', async () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('race-condition-socket');

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      jest.useFakeTimers();

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'race-condition-user',
        username: 'race-condition-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      // Schedule cancellation to happen just before timeout
      setTimeout(() => {
        const cancelData: ApprovalCancelData = {
          userId: 'race-condition-user',
          roomId: 'test-room'
        };
        handler.handleApprovalCancel(requesterSocket as any, cancelData, mockApprovalNamespace as any);
      }, 29999);

      // Advance to just before timeout
      jest.advanceTimersByTime(29999);

      // Verify session was cleaned up by cancellation
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('race-condition-user')).toBeUndefined();

      // Advance past timeout
      jest.advanceTimersByTime(2);

      // Verify no double processing occurred
      expect(mockRoomService.rejectMember).toHaveBeenCalledTimes(1);
      expect(requesterSocket.hasEmitted('approval_cancelled')).toBe(true);

      jest.useRealTimers();
    });

    it('should handle disconnect during approval process', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();
      const requesterSocket = new MockSocket('disconnect-socket');

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Create approval request
      const requestData: ApprovalRequestData = {
        roomId: 'test-room',
        userId: 'disconnect-user',
        username: 'disconnect-user',
        role: 'band_member'
      };

      handler.handleApprovalRequest(requesterSocket as any, requestData, mockApprovalNamespace as any);

      // Verify session exists
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('disconnect-user')).toBeDefined();

      // Handle disconnect
      handler.handleApprovalDisconnect(requesterSocket as any);

      // Verify session was cleaned up
      expect(mockApprovalSessionManager.getApprovalSessionByUserId('disconnect-user')).toBeUndefined();

      // Verify room service was called to reject member
      expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', 'disconnect-user');
    });

    it('should handle multiple disconnects gracefully', () => {
      const mockRoom = createMockRoom();
      mockRoomService.getRoom.mockReturnValue(mockRoom);
      mockRoomService.findUserInRoom.mockReturnValue(undefined);

      const mockApprovalNamespace = new MockNamespace();
      const mockRoomNamespace = new MockNamespace();

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockRoomNamespace as any);

      // Create multiple approval requests
      const users = ['disconnect-1', 'disconnect-2', 'disconnect-3'];
      const sockets = users.map(userId => new MockSocket(`${userId}-socket`));

      users.forEach((userId, index) => {
        const requestData: ApprovalRequestData = {
          roomId: 'test-room',
          userId,
          username: userId,
          role: 'band_member'
        };

        handler.handleApprovalRequest(sockets[index] as any, requestData, mockApprovalNamespace as any);
      });

      // Verify all sessions exist
      users.forEach(userId => {
        expect(mockApprovalSessionManager.getApprovalSessionByUserId(userId)).toBeDefined();
      });

      // Handle all disconnects
      sockets.forEach(socket => {
        handler.handleApprovalDisconnect(socket as any);
      });

      // Verify all sessions were cleaned up
      users.forEach(userId => {
        expect(mockApprovalSessionManager.getApprovalSessionByUserId(userId)).toBeUndefined();
      });

      // Verify room service was called for each user
      users.forEach(userId => {
        expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', userId);
      });
    });

    it('should handle session cleanup edge cases', () => {
      // Test cleanup when no session exists
      const nonExistentSocket = new MockSocket('non-existent-socket');
      
      // Should not throw error
      expect(() => {
        handler.handleApprovalDisconnect(nonExistentSocket as any);
      }).not.toThrow();

      // Test stats with no sessions
      const stats = mockApprovalSessionManager.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.oldestSessionAge).toBeNull();
    });

    it('should handle approval session manager edge cases', () => {
      // Test removing non-existent session by user ID
      const removedSession = mockApprovalSessionManager.removeApprovalSessionByUserId('non-existent-user');
      expect(removedSession).toBeUndefined();

      // Test getting sessions for non-existent room
      const roomSessions = mockApprovalSessionManager.getApprovalSessionsForRoom('non-existent-room');
      expect(roomSessions).toEqual([]);

      // Test hasApprovalSession for non-existent user
      const hasSession = mockApprovalSessionManager.hasApprovalSession('non-existent-user');
      expect(hasSession).toBe(false);
    });
  });

  describe('Basic Functionality', () => {
    it('should create an instance', () => {
      expect(handler).toBeDefined();
      expect(handler.getApprovalSessionManager()).toBeDefined();
    });

    it('should have all required methods', () => {
      expect(typeof handler.handleApprovalConnection).toBe('function');
      expect(typeof handler.handleApprovalRequest).toBe('function');
      expect(typeof handler.handleApprovalResponse).toBe('function');
      expect(typeof handler.handleApprovalCancel).toBe('function');
      expect(typeof handler.handleApprovalTimeout).toBe('function');
      expect(typeof handler.handleApprovalDisconnect).toBe('function');
      expect(typeof handler.getApprovalSessionManager).toBe('function');
    });
  });
});