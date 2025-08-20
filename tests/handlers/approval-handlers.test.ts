import { Server } from 'socket.io';
import { createServer } from 'http';
import { Socket } from 'socket.io';
import { NamespaceManager } from '../../src/services/NamespaceManager';
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { RoomHandlers } from '../../src/handlers/RoomHandlers';
import { ApprovalRequestData, ApprovalResponseData, ApprovalCancelData } from '../../src/types';

describe('Approval Handlers Unit Tests', () => {
  let io: Server;
  let namespaceManager: NamespaceManager;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let roomHandlers: RoomHandlers;
  let mockSocket: Partial<Socket>;
  let mockNamespace: any;

  beforeEach(() => {
    const httpServer = createServer();
    io = new Server(httpServer);
    
    namespaceManager = new NamespaceManager(io);
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    roomHandlers = new RoomHandlers(roomService, io, namespaceManager, roomSessionManager);

    // Mock socket
    mockSocket = {
      id: 'test-socket-id',
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: {}
    };

    // Mock namespace
    mockNamespace = {
      emit: jest.fn(),
      sockets: new Map()
    };
  });

  afterEach(() => {
    io.close();
  });

  describe('handleApprovalRequest', () => {
    let roomId: string;

    beforeEach(() => {
      // Create a private room
      const { room } = roomService.createRoom('Test Room', 'Owner', 'owner-123', true, false);
      roomId = room.id;
      namespaceManager.createRoomNamespace(roomId);
      namespaceManager.createApprovalNamespace(roomId);
    });

    test('should handle valid approval request', () => {
      const requestData: ApprovalRequestData = {
        roomId,
        userId: 'user-123',
        username: 'TestUser',
        role: 'band_member'
      };

      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);

      // Should emit approval_pending to the requesting user
      expect(mockSocket.emit).toHaveBeenCalledWith('approval_pending', {
        message: 'Waiting for room owner approval',
        timeoutMs: 30000
      });

      // Should add user to pending members
      const room = roomService.getRoom(roomId);
      expect(room?.pendingMembers.has('user-123')).toBe(true);
    });

    test('should reject request for non-existent room', () => {
      const requestData: ApprovalRequestData = {
        roomId: 'non-existent-room',
        userId: 'user-123',
        username: 'TestUser',
        role: 'band_member'
      };

      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);

      expect(mockSocket.emit).toHaveBeenCalledWith('approval_error', {
        message: 'Room not found'
      });
    });

    test('should reject duplicate approval requests', () => {
      const requestData: ApprovalRequestData = {
        roomId,
        userId: 'user-123',
        username: 'TestUser',
        role: 'band_member'
      };

      // First request
      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);
      
      // Reset mock
      (mockSocket.emit as jest.Mock).mockClear();

      // Second request (duplicate)
      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);

      expect(mockSocket.emit).toHaveBeenCalledWith('approval_error', {
        message: 'You already have a pending approval request'
      });
    });
  });

  describe('handleApprovalResponse', () => {
    let roomId: string;
    let ownerSocket: Partial<Socket>;

    beforeEach(() => {
      // Create a private room
      const { room } = roomService.createRoom('Test Room', 'Owner', 'owner-123', true, false);
      roomId = room.id;
      namespaceManager.createRoomNamespace(roomId);
      namespaceManager.createApprovalNamespace(roomId);

      // Set up owner socket session
      ownerSocket = {
        id: 'owner-socket-id',
        emit: jest.fn(),
        data: {}
      };

      roomSessionManager.setRoomSession(roomId, 'owner-socket-id', {
        roomId,
        userId: 'owner-123'
      });

      // Create an approval request first
      const requestData: ApprovalRequestData = {
        roomId,
        userId: 'user-456',
        username: 'RequestingUser',
        role: 'band_member'
      };
      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);
    });

    test('should approve user successfully', () => {
      const responseData: ApprovalResponseData = {
        userId: 'user-456',
        approved: true
      };

      // Mock the approval namespace to find the waiting user
      const approvalNamespace = {
        sockets: new Map([['test-socket-id', mockSocket]])
      };
      jest.spyOn(namespaceManager, 'getApprovalNamespace').mockReturnValue(approvalNamespace as any);

      roomHandlers.handleApprovalResponse(ownerSocket as Socket, responseData, mockNamespace);

      // Should emit approval_granted to the waiting user
      expect(mockSocket.emit).toHaveBeenCalledWith('approval_granted', expect.objectContaining({
        room: expect.any(Object)
      }));

      // Should emit user_joined to room namespace
      expect(mockNamespace.emit).toHaveBeenCalledWith('user_joined', expect.objectContaining({
        user: expect.objectContaining({
          id: 'user-456',
          username: 'RequestingUser'
        })
      }));

      // Should confirm to room owner
      expect(ownerSocket.emit).toHaveBeenCalledWith('approval_success', expect.objectContaining({
        message: 'User approved successfully',
        userId: 'user-456'
      }));
    });

    test('should reject user successfully', () => {
      const responseData: ApprovalResponseData = {
        userId: 'user-456',
        approved: false,
        message: 'Room is full'
      };

      // Mock the approval namespace to find the waiting user
      const approvalNamespace = {
        sockets: new Map([['test-socket-id', mockSocket]])
      };
      jest.spyOn(namespaceManager, 'getApprovalNamespace').mockReturnValue(approvalNamespace as any);

      roomHandlers.handleApprovalResponse(ownerSocket as Socket, responseData, mockNamespace);

      // Should emit approval_denied to the waiting user
      expect(mockSocket.emit).toHaveBeenCalledWith('approval_denied', {
        message: 'Room is full'
      });

      // Should confirm to room owner
      expect(ownerSocket.emit).toHaveBeenCalledWith('approval_success', expect.objectContaining({
        message: 'User rejected successfully',
        userId: 'user-456'
      }));
    });

    test('should handle approval for non-existent session', () => {
      const responseData: ApprovalResponseData = {
        userId: 'non-existent-user',
        approved: true
      };

      roomHandlers.handleApprovalResponse(ownerSocket as Socket, responseData, mockNamespace);

      expect(ownerSocket.emit).toHaveBeenCalledWith('approval_error', {
        message: 'User is no longer waiting for approval',
        userId: 'non-existent-user'
      });
    });
  });

  describe('handleApprovalCancel', () => {
    let roomId: string;

    beforeEach(() => {
      // Create a private room
      const { room } = roomService.createRoom('Test Room', 'Owner', 'owner-123', true, false);
      roomId = room.id;
      namespaceManager.createRoomNamespace(roomId);
      namespaceManager.createApprovalNamespace(roomId);

      // Create an approval request first
      const requestData: ApprovalRequestData = {
        roomId,
        userId: 'user-789',
        username: 'CancellingUser',
        role: 'band_member'
      };
      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);
    });

    test('should handle approval cancellation', () => {
      const cancelData: ApprovalCancelData = {
        userId: 'user-789',
        roomId
      };

      // Mock room namespace
      const roomNamespace = { emit: jest.fn() };
      jest.spyOn(namespaceManager, 'getRoomNamespace').mockReturnValue(roomNamespace as any);

      roomHandlers.handleApprovalCancel(mockSocket as Socket, cancelData, mockNamespace);

      // Should emit approval_cancelled to the user
      expect(mockSocket.emit).toHaveBeenCalledWith('approval_cancelled', {
        message: 'Your request has been cancelled'
      });

      // Should notify room owner
      expect(roomNamespace.emit).toHaveBeenCalledWith('approval_request_cancelled', {
        userId: 'user-789',
        username: 'CancellingUser',
        message: 'User cancelled their join request'
      });

      // Should disconnect the socket
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleApprovalTimeout', () => {
    let roomId: string;

    beforeEach(() => {
      // Create a private room
      const { room } = roomService.createRoom('Test Room', 'Owner', 'owner-123', true, false);
      roomId = room.id;
      namespaceManager.createRoomNamespace(roomId);
      namespaceManager.createApprovalNamespace(roomId);
    });

    test('should handle approval timeout', () => {
      const approvalSession = {
        roomId,
        userId: 'user-timeout',
        username: 'TimeoutUser',
        role: 'band_member' as const,
        requestedAt: new Date()
      };

      // Mock namespaces
      const roomNamespace = { emit: jest.fn() };
      const approvalNamespace = { 
        sockets: new Map([['test-socket-id', mockSocket]])
      };
      jest.spyOn(namespaceManager, 'getRoomNamespace').mockReturnValue(roomNamespace as any);
      jest.spyOn(namespaceManager, 'getApprovalNamespace').mockReturnValue(approvalNamespace as any);

      roomHandlers.handleApprovalTimeout('test-socket-id', approvalSession);

      // Should notify room owner
      expect(roomNamespace.emit).toHaveBeenCalledWith('approval_request_cancelled', {
        userId: 'user-timeout',
        username: 'TimeoutUser',
        message: 'Approval request timed out'
      });

      // Should notify the waiting user
      expect(mockSocket.emit).toHaveBeenCalledWith('approval_timeout', {
        message: 'Your approval request has timed out'
      });

      // Should disconnect the socket
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleApprovalDisconnect', () => {
    let roomId: string;

    beforeEach(() => {
      // Create a private room
      const { room } = roomService.createRoom('Test Room', 'Owner', 'owner-123', true, false);
      roomId = room.id;
      namespaceManager.createRoomNamespace(roomId);
      namespaceManager.createApprovalNamespace(roomId);

      // Create an approval request first
      const requestData: ApprovalRequestData = {
        roomId,
        userId: 'user-disconnect',
        username: 'DisconnectUser',
        role: 'band_member'
      };
      roomHandlers.handleApprovalRequest(mockSocket as Socket, requestData, mockNamespace);
    });

    test('should handle approval disconnect', () => {
      // Mock room namespace
      const roomNamespace = { emit: jest.fn() };
      jest.spyOn(namespaceManager, 'getRoomNamespace').mockReturnValue(roomNamespace as any);

      roomHandlers.handleApprovalDisconnect(mockSocket as Socket);

      // Should notify room owner
      expect(roomNamespace.emit).toHaveBeenCalledWith('approval_request_cancelled', {
        userId: 'user-disconnect',
        username: 'DisconnectUser',
        message: 'User disconnected'
      });
    });
  });
});