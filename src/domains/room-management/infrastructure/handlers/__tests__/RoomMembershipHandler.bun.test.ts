import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { RoomMembershipHandler } from '../RoomMembershipHandler';
import { RoomService } from '../../../../../services/RoomService';
import { NamespaceManager } from '../../../../../services/NamespaceManager';
import { RoomSessionManager, NamespaceSession } from '../../../../../services/RoomSessionManager';
import { Server, Socket, Namespace } from 'socket.io';
import { User, Room } from '../../../../../types';

/**
 * RoomMembershipHandler Bun Test Suite
 * 
 * Tests member management workflows using Bun test runner with focus on:
 * - Member approval and rejection scenarios
 * - Room state updates verification
 * - Edge cases with concurrent member operations
 * - Performance testing with Bun's nanosecond timer
 * 
 * Requirements: 7.2, 8.1
 */

// Mock implementations optimized for Bun testing
class MockSocket {
  public id: string;
  private events: Map<string, any[]> = new Map();
  public data: any = {};

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

  getLastEmittedData(event: string): any {
    const events = this.getEmittedEvents(event);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  clearEvents(): void {
    this.events.clear();
  }

  disconnect(): void {
    // Mock disconnect
  }
}

class MockNamespace {
  public name: string;
  public sockets: Map<string, MockSocket> = new Map();
  private events: Map<string, any[]> = new Map();

  constructor(name: string = '/room/test-room') {
    this.name = name;
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

  getLastEmittedData(event: string): any {
    const events = this.getEmittedEvents(event);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  addSocket(socket: MockSocket): void {
    this.sockets.set(socket.id, socket);
  }

  clearEvents(): void {
    this.events.clear();
  }
}

describe('RoomMembershipHandler - Bun Runtime Tests', () => {
  let handler: RoomMembershipHandler;
  let mockRoomService: Partial<RoomService>;
  let mockIo: Partial<Server>;
  let mockNamespaceManager: Partial<NamespaceManager>;
  let mockRoomSessionManager: Partial<RoomSessionManager>;

  const createMockRoom = (overrides: Partial<Room> = {}): Room => ({
    id: 'test-room',
    name: 'Test Room',
    owner: 'owner-id',
    users: new Map(),
    pendingMembers: new Map(),
      roomType: 'perform' as const,
    metronome: { bpm: 120, lastTickTimestamp: Date.now() },
    isPrivate: true,
    isHidden: false,
    createdAt: new Date(),
    ...overrides
  });

  const createMockUser = (id: string, username: string, role: string = 'band_member'): User => ({
    id,
    username,
    role: role as any,
    isReady: false
  });

  const createMockSession = (roomId: string = 'test-room', userId: string = 'owner-id'): NamespaceSession => ({
    roomId,
    userId,
    socketId: `${userId}-socket`,
    namespacePath: `/room/${roomId}`,
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  beforeEach(() => {
    // Create mock services with comprehensive functionality
    mockRoomService = {
      getRoom: () => createMockRoom(),
      isRoomOwner: () => true,
      approveMember: (roomId: string, userId: string) => createMockUser(userId, `user-${userId}`),
      rejectMember: (roomId: string, userId: string) => createMockUser(userId, `user-${userId}`),
      getRoomUsers: () => [createMockUser('owner-id', 'owner', 'room_owner')],
      getPendingMembers: () => [],
      findUserInRoom: () => undefined
    };

    mockIo = {};

    mockNamespaceManager = {
      getRoomNamespace: () => new MockNamespace() as any
    };

    mockRoomSessionManager = {
      getRoomSession: () => createMockSession()
    };

    handler = new RoomMembershipHandler(
      mockRoomService as RoomService,
      mockIo as Server,
      mockNamespaceManager as NamespaceManager,
      mockRoomSessionManager as RoomSessionManager
    );
  });

  describe('Member Approval Scenarios', () => {
    it('should approve pending member successfully with performance tracking', () => {
      const mockSocket = new MockSocket('owner-socket');
      const mockNamespace = new MockNamespace();
      const pendingUser = createMockUser('pending-user-id', 'pending-user');

      // Setup room with pending member
      const room = createMockRoom({
        users: new Map([['owner-id', createMockUser('owner-id', 'owner', 'room_owner')]]),
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      // Measure approval performance using Bun's nanosecond timer
      const startTime = Bun.nanoseconds();
      
      handler.handleApproveMember(mockSocket as any, { userId: 'pending-user-id' });
      
      const approvalTime = Bun.nanoseconds() - startTime;

      // Verify performance (should be under 10ms = 10,000,000 nanoseconds)
      expect(approvalTime).toBeLessThan(10_000_000);

      // Verify room service was called
      expect(mockRoomService.approveMember).toBeDefined();

      // Verify namespace events were emitted
      expect(mockNamespace.hasEmitted('user_joined')).toBe(true);
      expect(mockNamespace.hasEmitted('room_state_updated')).toBe(true);

      // Verify confirmation was sent to owner
      expect(mockSocket.hasEmitted('member_approved')).toBe(true);
      const approvalData = mockSocket.getLastEmittedData('member_approved');
      expect(approvalData.userId).toBe('pending-user-id');
      expect(approvalData.username).toBe('user-pending-user-id');
    });

    it('should handle approval with room state verification', () => {
      const mockSocket = new MockSocket('owner-socket');
      const mockNamespace = new MockNamespace();
      const pendingUser = createMockUser('pending-user-id', 'pending-user');
      const existingUser = createMockUser('existing-user', 'existing-user');

      const room = createMockRoom({
        users: new Map([
          ['owner-id', createMockUser('owner-id', 'owner', 'room_owner')],
          ['existing-user', existingUser]
        ]),
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;
      mockRoomService.getRoomUsers = () => [
        createMockUser('owner-id', 'owner', 'room_owner'),
        existingUser,
        pendingUser
      ];
      mockRoomService.getPendingMembers = () => []; // Empty after approval
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      handler.handleApproveMember(mockSocket as any, { userId: 'pending-user-id' });

      // Verify room state update contains correct data
      expect(mockNamespace.hasEmitted('room_state_updated')).toBe(true);
      const roomStateData = mockNamespace.getLastEmittedData('room_state_updated');
      
      expect(roomStateData.room).toBeDefined();
      expect(roomStateData.room.id).toBe('test-room');
      expect(roomStateData.room.users).toHaveLength(3); // owner + existing + approved
      expect(roomStateData.room.pendingMembers).toHaveLength(0); // Empty after approval
    });

    it('should reject approval for non-pending users', () => {
      const mockSocket = new MockSocket('owner-socket');
      const room = createMockRoom({
        users: new Map([['owner-id', createMockUser('owner-id', 'owner', 'room_owner')]]),
        pendingMembers: new Map() // No pending members
      });

      mockRoomService.getRoom = () => room;

      handler.handleApproveMember(mockSocket as any, { userId: 'non-pending-user' });

      // Verify error was emitted
      expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      const errorData = mockSocket.getLastEmittedData('membership_error');
      expect(errorData.message).toBe('User is not in pending members');
      expect(errorData.userId).toBe('non-pending-user');
    });

    it('should reject approval from non-owners', () => {
      const mockSocket = new MockSocket('non-owner-socket');
      const room = createMockRoom({
        pendingMembers: new Map([['pending-user-id', createMockUser('pending-user-id', 'pending-user')]])
      });

      mockRoomService.getRoom = () => room;
      mockRoomService.isRoomOwner = () => false; // Not room owner
      mockRoomSessionManager.getRoomSession = () => createMockSession('test-room', 'non-owner-id');

      handler.handleApproveMember(mockSocket as any, { userId: 'pending-user-id' });

      // Verify error was emitted
      expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      const errorData = mockSocket.getLastEmittedData('membership_error');
      expect(errorData.message).toBe('Only room owner can approve members');
    });
  });

  describe('Member Rejection Scenarios', () => {
    it('should reject pending member successfully with reason tracking', () => {
      const mockSocket = new MockSocket('owner-socket');
      const mockNamespace = new MockNamespace();
      const pendingUser = createMockUser('pending-user-id', 'pending-user');

      const room = createMockRoom({
        users: new Map([['owner-id', createMockUser('owner-id', 'owner', 'room_owner')]]),
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;
      mockRoomService.getPendingMembers = () => []; // Empty after rejection
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      const rejectionReason = 'Not suitable for this room';

      // Measure rejection performance
      const startTime = Bun.nanoseconds();
      
      handler.handleRejectMember(mockSocket as any, { 
        userId: 'pending-user-id',
        message: rejectionReason
      });
      
      const rejectionTime = Bun.nanoseconds() - startTime;

      // Verify performance (should be under 10ms)
      expect(rejectionTime).toBeLessThan(10_000_000);

      // Verify room state update was emitted
      expect(mockNamespace.hasEmitted('room_state_updated')).toBe(true);
      const roomStateData = mockNamespace.getLastEmittedData('room_state_updated');
      expect(roomStateData.room.pendingMembers).toHaveLength(0);

      // Verify confirmation was sent to owner
      expect(mockSocket.hasEmitted('member_rejected')).toBe(true);
      const rejectionData = mockSocket.getLastEmittedData('member_rejected');
      expect(rejectionData.userId).toBe('pending-user-id');
      expect(rejectionData.username).toBe('user-pending-user-id');
    });

    it('should handle rejection without reason message', () => {
      const mockSocket = new MockSocket('owner-socket');
      const mockNamespace = new MockNamespace();
      const pendingUser = createMockUser('pending-user-id', 'pending-user');

      const room = createMockRoom({
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      handler.handleRejectMember(mockSocket as any, { userId: 'pending-user-id' });

      // Should still work without message
      expect(mockSocket.hasEmitted('member_rejected')).toBe(true);
      expect(mockNamespace.hasEmitted('room_state_updated')).toBe(true);
    });

    it('should reject rejection for non-pending users', () => {
      const mockSocket = new MockSocket('owner-socket');
      const room = createMockRoom({
        pendingMembers: new Map() // No pending members
      });

      mockRoomService.getRoom = () => room;

      handler.handleRejectMember(mockSocket as any, { userId: 'non-pending-user' });

      // Verify error was emitted
      expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      const errorData = mockSocket.getLastEmittedData('membership_error');
      expect(errorData.message).toBe('User is not in pending members');
    });
  });

  describe('Namespace-Aware Operations', () => {
    it('should handle approval through namespace correctly', () => {
      const mockSocket = new MockSocket('owner-socket');
      const mockNamespace = new MockNamespace('/room/test-room');
      const pendingUser = createMockUser('pending-user-id', 'pending-user');

      const room = createMockRoom({
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;

      handler.handleApproveMemberNamespace(mockSocket as any, { userId: 'pending-user-id' }, mockNamespace as any);

      // Verify namespace-specific events
      expect(mockNamespace.hasEmitted('user_joined')).toBe(true);
      expect(mockNamespace.hasEmitted('room_state_updated')).toBe(true);
      expect(mockSocket.hasEmitted('member_approved')).toBe(true);
    });

    it('should handle rejection through namespace correctly', () => {
      const mockSocket = new MockSocket('owner-socket');
      const mockNamespace = new MockNamespace('/room/test-room');
      const pendingUser = createMockUser('pending-user-id', 'pending-user');

      const room = createMockRoom({
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;

      handler.handleRejectMemberNamespace(mockSocket as any, { 
        userId: 'pending-user-id',
        message: 'Namespace rejection test'
      }, mockNamespace as any);

      // Verify namespace-specific events
      expect(mockNamespace.hasEmitted('room_state_updated')).toBe(true);
      expect(mockSocket.hasEmitted('member_rejected')).toBe(true);
    });
  });

  describe('Concurrent Member Operations', () => {
    it('should handle concurrent approval requests efficiently', async () => {
      const userCount = 25;
      const users = Array.from({ length: userCount }, (_, i) => createMockUser(`user-${i}`, `User${i}`));
      const sockets = users.map(user => new MockSocket(`${user.id}-socket`));
      const mockNamespace = new MockNamespace();

      // Setup room with all users as pending
      const pendingMembers = new Map(users.map(user => [user.id, user]));
      const room = createMockRoom({ pendingMembers });

      mockRoomService.getRoom = () => room;
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      // Measure concurrent approval performance
      const startTime = Bun.nanoseconds();

      const concurrentApprovals = users.map((user, index) => {
        return new Promise<void>((resolve) => {
          // Stagger requests slightly to simulate real-world timing
          setTimeout(() => {
            handler.handleApproveMember(sockets[index] as any, { userId: user.id });
            resolve();
          }, Math.random() * 10);
        });
      });

      await Promise.all(concurrentApprovals);

      const totalTime = Bun.nanoseconds() - startTime;
      const averageTimePerApproval = totalTime / userCount;

      // Verify performance: each approval should average under 5ms
      expect(averageTimePerApproval).toBeLessThan(5_000_000);

      // Verify all approvals were processed
      sockets.forEach(socket => {
        expect(socket.hasEmitted('member_approved')).toBe(true);
      });

      // Verify namespace received all events
      const userJoinedEvents = mockNamespace.getEmittedEvents('user_joined');
      const roomStateEvents = mockNamespace.getEmittedEvents('room_state_updated');
      
      expect(userJoinedEvents).toHaveLength(userCount);
      expect(roomStateEvents).toHaveLength(userCount);
    });

    it('should handle mixed concurrent approval and rejection operations', async () => {
      const approvalCount = 15;
      const rejectionCount = 10;
      const totalUsers = approvalCount + rejectionCount;

      const approvalUsers = Array.from({ length: approvalCount }, (_, i) => 
        createMockUser(`approve-user-${i}`, `ApproveUser${i}`)
      );
      const rejectionUsers = Array.from({ length: rejectionCount }, (_, i) => 
        createMockUser(`reject-user-${i}`, `RejectUser${i}`)
      );

      const allUsers = [...approvalUsers, ...rejectionUsers];
      const sockets = allUsers.map(user => new MockSocket(`${user.id}-socket`));
      const mockNamespace = new MockNamespace();

      // Setup room with all users as pending
      const pendingMembers = new Map(allUsers.map(user => [user.id, user]));
      const room = createMockRoom({ pendingMembers });

      mockRoomService.getRoom = () => room;
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      // Measure concurrent mixed operations performance
      const startTime = Bun.nanoseconds();

      const concurrentOperations = allUsers.map((user, index) => {
        return new Promise<void>((resolve) => {
          const isApproval = index < approvalCount;
          
          setTimeout(() => {
            if (isApproval) {
              handler.handleApproveMember(sockets[index] as any, { userId: user.id });
            } else {
              handler.handleRejectMember(sockets[index] as any, { 
                userId: user.id,
                message: 'Concurrent rejection test'
              });
            }
            resolve();
          }, Math.random() * 20);
        });
      });

      await Promise.all(concurrentOperations);

      const totalTime = Bun.nanoseconds() - startTime;
      const averageTimePerOperation = totalTime / totalUsers;

      // Verify performance: each operation should average under 5ms
      expect(averageTimePerOperation).toBeLessThan(5_000_000);

      // Verify approvals
      for (let i = 0; i < approvalCount; i++) {
        expect(sockets[i].hasEmitted('member_approved')).toBe(true);
      }

      // Verify rejections
      for (let i = approvalCount; i < totalUsers; i++) {
        expect(sockets[i].hasEmitted('member_rejected')).toBe(true);
      }

      // Verify namespace events
      const userJoinedEvents = mockNamespace.getEmittedEvents('user_joined');
      const roomStateEvents = mockNamespace.getEmittedEvents('room_state_updated');
      
      expect(userJoinedEvents).toHaveLength(approvalCount);
      expect(roomStateEvents).toHaveLength(totalUsers); // Both approvals and rejections update room state
    });

    it('should handle rapid sequential operations without race conditions', async () => {
      const operationCount = 100;
      const mockSocket = new MockSocket('rapid-test-socket');
      const mockNamespace = new MockNamespace();

      // Create users for rapid operations
      const users = Array.from({ length: operationCount }, (_, i) => 
        createMockUser(`rapid-user-${i}`, `RapidUser${i}`)
      );

      let currentPendingMembers = new Map(users.map(user => [user.id, user]));

      // Mock room service to simulate state changes
      mockRoomService.getRoom = () => createMockRoom({ 
        pendingMembers: new Map(currentPendingMembers) 
      });

      mockRoomService.approveMember = (roomId: string, userId: string) => {
        const user = currentPendingMembers.get(userId);
        if (user) {
          currentPendingMembers.delete(userId);
          return user;
        }
        return undefined;
      };

      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      const timings: number[] = [];

      // Perform rapid sequential operations
      for (let i = 0; i < operationCount; i++) {
        const user = users[i];
        
        const startTime = Bun.nanoseconds();
        handler.handleApproveMember(mockSocket as any, { userId: user.id });
        const endTime = Bun.nanoseconds();
        
        timings.push(endTime - startTime);
      }

      // Analyze performance consistency
      const averageTime = timings.reduce((sum, time) => sum + time, 0) / timings.length;
      const maxTime = Math.max(...timings);
      const minTime = Math.min(...timings);

      // Verify performance consistency
      expect(averageTime).toBeLessThan(3_000_000); // Under 3ms average
      expect(maxTime).toBeLessThan(15_000_000); // Under 15ms max
      expect(maxTime / minTime).toBeLessThan(1000); // Max should not be more than 1000x min

      // Verify all operations completed
      const approvalEvents = mockSocket.getEmittedEvents('member_approved');
      expect(approvalEvents).toHaveLength(operationCount);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing room session gracefully', () => {
      const mockSocket = new MockSocket('no-session-socket');
      
      mockRoomSessionManager.getRoomSession = () => undefined;

      handler.handleApproveMember(mockSocket as any, { userId: 'test-user' });

      expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      const errorData = mockSocket.getLastEmittedData('membership_error');
      expect(errorData.message).toBe('You are not in a room');
    });

    it('should handle non-existent room gracefully', () => {
      const mockSocket = new MockSocket('no-room-socket');
      
      mockRoomService.getRoom = () => undefined;

      handler.handleApproveMember(mockSocket as any, { userId: 'test-user' });

      expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      const errorData = mockSocket.getLastEmittedData('membership_error');
      expect(errorData.message).toBe('Room not found');
    });

    it('should handle service failures gracefully', () => {
      const mockSocket = new MockSocket('service-failure-socket');
      const mockNamespace = new MockNamespace();
      const pendingUser = createMockUser('pending-user-id', 'pending-user');

      const room = createMockRoom({
        pendingMembers: new Map([['pending-user-id', pendingUser]])
      });

      mockRoomService.getRoom = () => room;
      mockRoomService.approveMember = () => undefined; // Simulate service failure
      mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

      handler.handleApproveMember(mockSocket as any, { userId: 'pending-user-id' });

      expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      const errorData = mockSocket.getLastEmittedData('membership_error');
      expect(errorData.message).toBe('Failed to approve member');
      expect(errorData.userId).toBe('pending-user-id');
    });

    it('should handle malformed request data', () => {
      const mockSocket = new MockSocket('malformed-data-socket');

      // Test with various malformed data
      const malformedRequests = [
        { userId: '' }, // Empty user ID
        { userId: null }, // Null user ID
        { userId: undefined }, // Undefined user ID
        {}, // Missing user ID
        { userId: 'valid-id', roomId: '' }, // Empty room ID
      ];

      malformedRequests.forEach((data, index) => {
        mockSocket.clearEvents();
        
        handler.handleApproveMember(mockSocket as any, data as any);
        
        // Should handle gracefully without throwing
        expect(mockSocket.hasEmitted('membership_error')).toBe(true);
      });
    });
  });

  describe('Utility Methods', () => {
    it('should get pending members correctly', () => {
      const pendingUsers = [
        createMockUser('pending-1', 'Pending1'),
        createMockUser('pending-2', 'Pending2')
      ];

      mockRoomService.getPendingMembers = () => pendingUsers;

      const result = handler.getPendingMembers('test-room');

      expect(result).toEqual(pendingUsers);
      expect(result).toHaveLength(2);
    });

    it('should check pending member status correctly', () => {
      const pendingUser = createMockUser('pending-user', 'PendingUser');
      const room = createMockRoom({
        pendingMembers: new Map([['pending-user', pendingUser]])
      });

      mockRoomService.getRoom = () => room;

      expect(handler.isPendingMember('test-room', 'pending-user')).toBe(true);
      expect(handler.isPendingMember('test-room', 'non-pending-user')).toBe(false);
    });

    it('should get member count correctly', () => {
      const users = new Map([
        ['user-1', createMockUser('user-1', 'User1')],
        ['user-2', createMockUser('user-2', 'User2')],
        ['user-3', createMockUser('user-3', 'User3')]
      ]);

      const room = createMockRoom({ users });
      mockRoomService.getRoom = () => room;

      expect(handler.getMemberCount('test-room')).toBe(3);
    });

    it('should get pending member count correctly', () => {
      const pendingMembers = new Map([
        ['pending-1', createMockUser('pending-1', 'Pending1')],
        ['pending-2', createMockUser('pending-2', 'Pending2')]
      ]);

      const room = createMockRoom({ pendingMembers });
      mockRoomService.getRoom = () => room;

      expect(handler.getPendingMemberCount('test-room')).toBe(2);
    });

    it('should handle non-existent room in utility methods', () => {
      mockRoomService.getRoom = () => undefined;

      expect(handler.isPendingMember('non-existent-room', 'user-id')).toBe(false);
      expect(handler.getMemberCount('non-existent-room')).toBe(0);
      expect(handler.getPendingMemberCount('non-existent-room')).toBe(0);
    });
  });

  describe('Memory and Resource Management', () => {
    it('should handle large-scale member operations without memory leaks', async () => {
      const initialMemory = process.memoryUsage();
      const batchSize = 100;
      const batchCount = 10;

      for (let batch = 0; batch < batchCount; batch++) {
        const users = Array.from({ length: batchSize }, (_, i) => 
          createMockUser(`batch-${batch}-user-${i}`, `BatchUser${batch}-${i}`)
        );
        const sockets = users.map(user => new MockSocket(`${user.id}-socket`));
        const mockNamespace = new MockNamespace();

        const pendingMembers = new Map(users.map(user => [user.id, user]));
        const room = createMockRoom({ pendingMembers });

        mockRoomService.getRoom = () => room;
        mockNamespaceManager.getRoomNamespace = () => mockNamespace as any;

        // Process all users in batch
        const operations = users.map((user, index) => {
          return new Promise<void>((resolve) => {
            const isApproval = index % 2 === 0;
            
            if (isApproval) {
              handler.handleApproveMember(sockets[index] as any, { userId: user.id });
            } else {
              handler.handleRejectMember(sockets[index] as any, { userId: user.id });
            }
            resolve();
          });
        });

        await Promise.all(operations);

        // Clear references to help GC
        sockets.forEach(socket => socket.clearEvents());
        mockNamespace.clearEvents();
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 50MB for 1000 operations)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});