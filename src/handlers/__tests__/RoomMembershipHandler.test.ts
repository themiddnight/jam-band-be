import { RoomMembershipHandler } from '../RoomMembershipHandler';
import { RoomService } from '../../services/RoomService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager, NamespaceSession } from '../../services/RoomSessionManager';
import { Server, Socket, Namespace } from 'socket.io';
import { User, Room } from '../../types';

// Mock dependencies
jest.mock('../../services/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn()
  }
}));

describe('RoomMembershipHandler', () => {
  let handler: RoomMembershipHandler;
  let mockRoomService: jest.Mocked<RoomService>;
  let mockIo: jest.Mocked<Server>;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockSocket: jest.Mocked<Socket>;
  let mockNamespace: jest.Mocked<Namespace>;

  const mockRoom: Room = {
    id: 'test-room',
    name: 'Test Room',
    owner: 'owner-id',
    users: new Map(),
    pendingMembers: new Map(),
    metronome: { bpm: 120, lastTickTimestamp: 0 },
    isPrivate: true,
    isHidden: false,
    createdAt: new Date()
  };

  const mockOwner: User = {
    id: 'owner-id',
    username: 'owner',
    role: 'room_owner',
    isReady: true
  };

  const mockPendingUser: User = {
    id: 'pending-user-id',
    username: 'pending-user',
    role: 'band_member',
    isReady: false
  };

  const createMockSession = (): NamespaceSession => ({
    roomId: 'test-room',
    userId: 'owner-id',
    socketId: 'socket-123',
    namespacePath: '/room/test-room',
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock services
    mockRoomService = {
      getRoom: jest.fn(),
      isRoomOwner: jest.fn(),
      approveMember: jest.fn(),
      rejectMember: jest.fn(),
      getRoomUsers: jest.fn(),
      getPendingMembers: jest.fn(),
      findUserInRoom: jest.fn()
    } as any;

    mockIo = {
      emit: jest.fn()
    } as any;

    mockNamespaceManager = {
      getRoomNamespace: jest.fn()
    } as any;

    mockRoomSessionManager = {
      getRoomSession: jest.fn()
    } as any;

    mockSocket = {
      id: 'socket-123',
      emit: jest.fn(),
      broadcast: {
        emit: jest.fn()
      }
    } as any;

    mockNamespace = {
      name: '/room/test-room',
      emit: jest.fn(),
      sockets: new Map()
    } as any;

    // Create handler instance
    handler = new RoomMembershipHandler(
      mockRoomService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  describe('basic functionality', () => {
    it('should create handler instance', () => {
      expect(handler).toBeDefined();
      expect(handler).toBeInstanceOf(RoomMembershipHandler);
    });
  });

  describe('handleApproveMember', () => {
    beforeEach(() => {
      // Setup default mocks
      mockRoomSessionManager.getRoomSession.mockReturnValue(createMockSession());
      mockRoomService.getRoom.mockReturnValue({
        ...mockRoom,
        users: new Map([['owner-id', mockOwner]]),
        pendingMembers: new Map([['pending-user-id', mockPendingUser]])
      });
      mockRoomService.isRoomOwner.mockReturnValue(true);
      mockRoomService.approveMember.mockReturnValue(mockPendingUser);
      mockRoomService.getRoomUsers.mockReturnValue([mockOwner, mockPendingUser]);
      mockRoomService.getPendingMembers.mockReturnValue([]);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace);
    });

    it('should approve a pending member successfully', () => {
      const data = { userId: 'pending-user-id' };

      handler.handleApproveMember(mockSocket, data);

      // Verify room service was called to approve member
      expect(mockRoomService.approveMember).toHaveBeenCalledWith('test-room', 'pending-user-id');

      // Verify namespace events were emitted
      expect(mockNamespace.emit).toHaveBeenCalledWith('user_joined', { user: mockPendingUser });
      expect(mockNamespace.emit).toHaveBeenCalledWith('room_state_updated', expect.objectContaining({
        room: expect.objectContaining({
          id: 'test-room',
          users: expect.any(Array),
          pendingMembers: expect.any(Array)
        })
      }));

      // Verify confirmation was sent to owner
      expect(mockSocket.emit).toHaveBeenCalledWith('member_approved', {
        message: 'Member approved successfully',
        userId: 'pending-user-id',
        username: 'pending-user'
      });
    });

    it('should reject approval if user is not in a room', () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      handler.handleApproveMember(mockSocket, { userId: 'pending-user-id' });

      expect(mockSocket.emit).toHaveBeenCalledWith('membership_error', {
        message: 'You are not in a room'
      });
      expect(mockRoomService.approveMember).not.toHaveBeenCalled();
    });

    it('should reject approval if room does not exist', () => {
      mockRoomService.getRoom.mockReturnValue(undefined);

      handler.handleApproveMember(mockSocket, { userId: 'pending-user-id' });

      expect(mockSocket.emit).toHaveBeenCalledWith('membership_error', {
        message: 'Room not found'
      });
      expect(mockRoomService.approveMember).not.toHaveBeenCalled();
    });

    it('should reject approval if user is not room owner', () => {
      mockRoomService.isRoomOwner.mockReturnValue(false);

      handler.handleApproveMember(mockSocket, { userId: 'pending-user-id' });

      expect(mockSocket.emit).toHaveBeenCalledWith('membership_error', {
        message: 'Only room owner can approve members'
      });
      expect(mockRoomService.approveMember).not.toHaveBeenCalled();
    });
  });

  describe('handleRejectMember', () => {
    beforeEach(() => {
      // Setup default mocks
      mockRoomSessionManager.getRoomSession.mockReturnValue(createMockSession());
      mockRoomService.getRoom.mockReturnValue({
        ...mockRoom,
        users: new Map([['owner-id', mockOwner]]),
        pendingMembers: new Map([['pending-user-id', mockPendingUser]])
      });
      mockRoomService.isRoomOwner.mockReturnValue(true);
      mockRoomService.rejectMember.mockReturnValue(mockPendingUser);
      mockRoomService.getRoomUsers.mockReturnValue([mockOwner]);
      mockRoomService.getPendingMembers.mockReturnValue([]);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace);
    });

    it('should reject a pending member successfully', () => {
      const data = { userId: 'pending-user-id', message: 'Not suitable for this room' };

      handler.handleRejectMember(mockSocket, data);

      // Verify room service was called to reject member
      expect(mockRoomService.rejectMember).toHaveBeenCalledWith('test-room', 'pending-user-id');

      // Verify room state update was emitted
      expect(mockNamespace.emit).toHaveBeenCalledWith('room_state_updated', expect.objectContaining({
        room: expect.objectContaining({
          id: 'test-room',
          users: expect.any(Array),
          pendingMembers: expect.any(Array)
        })
      }));

      // Verify confirmation was sent to owner
      expect(mockSocket.emit).toHaveBeenCalledWith('member_rejected', {
        message: 'Member rejected successfully',
        userId: 'pending-user-id',
        username: 'pending-user'
      });
    });

    it('should reject rejection if user is not in a room', () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      handler.handleRejectMember(mockSocket, { userId: 'pending-user-id' });

      expect(mockSocket.emit).toHaveBeenCalledWith('membership_error', {
        message: 'You are not in a room'
      });
      expect(mockRoomService.rejectMember).not.toHaveBeenCalled();
    });
  });

  describe('utility methods', () => {
    it('should get pending members', () => {
      mockRoomService.getPendingMembers.mockReturnValue([mockPendingUser]);

      const result = handler.getPendingMembers('test-room');

      expect(result).toEqual([mockPendingUser]);
      expect(mockRoomService.getPendingMembers).toHaveBeenCalledWith('test-room');
    });

    it('should check if user is pending member', () => {
      mockRoomService.getRoom.mockReturnValue({
        ...mockRoom,
        pendingMembers: new Map([['pending-user-id', mockPendingUser]])
      });

      const result = handler.isPendingMember('test-room', 'pending-user-id');

      expect(result).toBe(true);
    });

    it('should get member count', () => {
      mockRoomService.getRoom.mockReturnValue({
        ...mockRoom,
        users: new Map([['owner-id', mockOwner], ['user-2', mockPendingUser]])
      });

      const result = handler.getMemberCount('test-room');

      expect(result).toBe(2);
    });
  });

  describe('concurrent member operations', () => {
    it('should handle concurrent approval requests', async () => {
      const pendingUser2: User = {
        id: 'pending-user-2',
        username: 'pending-user-2',
        role: 'band_member',
        isReady: false
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(createMockSession());
      mockRoomService.getRoom.mockReturnValue({
        ...mockRoom,
        users: new Map([['owner-id', mockOwner]]),
        pendingMembers: new Map([
          ['pending-user-id', mockPendingUser],
          ['pending-user-2', pendingUser2]
        ])
      });
      mockRoomService.isRoomOwner.mockReturnValue(true);

      // Mock successful approvals
      mockRoomService.approveMember
        .mockReturnValueOnce(mockPendingUser)
        .mockReturnValueOnce(pendingUser2);

      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace);

      // Simulate concurrent approval requests
      const promise1 = new Promise<void>((resolve) => {
        handler.handleApproveMember(mockSocket, { userId: 'pending-user-id' });
        resolve();
      });

      const promise2 = new Promise<void>((resolve) => {
        handler.handleApproveMember(mockSocket, { userId: 'pending-user-2' });
        resolve();
      });

      await Promise.all([promise1, promise2]);

      // Verify both users were approved
      expect(mockRoomService.approveMember).toHaveBeenCalledWith('test-room', 'pending-user-id');
      expect(mockRoomService.approveMember).toHaveBeenCalledWith('test-room', 'pending-user-2');
      expect(mockNamespace.emit).toHaveBeenCalledTimes(4); // 2 user_joined + 2 room_state_updated
    });
  });
});