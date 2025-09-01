import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RoomHandlers } from '../RoomHandlers';
import { RoomService } from '../../services/RoomService';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { Socket } from 'socket.io';

describe('RoomHandlers Coordination Layer', () => {
  let roomHandlers: RoomHandlers;
  let mockRoomService: any;
  let mockRoomSessionManager: any;
  let mockSocket: any;
  let mockRoomLifecycleHandler: any;
  let mockRoomMembershipHandler: any;
  let mockApprovalWorkflowHandler: any;

  beforeEach(() => {
    // Create mocks
    mockRoomService = {
      getAllRooms: jest.fn(() => []),
      getRoom: jest.fn(() => null),
    };
    
    mockRoomSessionManager = {
      getRoomSession: jest.fn(() => null),
      setRoomSession: jest.fn(() => {}),
      removeSession: jest.fn(() => {}),
    };
    
    mockSocket = {
      id: 'test-socket-id',
      emit: jest.fn(() => {}),
      to: jest.fn(() => mockSocket),
      broadcast: {
        emit: jest.fn(() => {}),
      },
    };

    // Create domain handler mocks
    mockRoomLifecycleHandler = {
      handleCreateRoomHttp: jest.fn(() => {}),
      handleLeaveRoomHttp: jest.fn(() => {}),
      handleJoinRoom: jest.fn(() => {}),
      handleLeaveRoom: jest.fn(() => {}),
    };

    mockRoomMembershipHandler = {
      handleTransferOwnership: jest.fn(() => {}),
      handleTransferOwnershipNamespace: jest.fn(() => {}),
    };

    mockApprovalWorkflowHandler = {
      handleApprovalDisconnect: jest.fn(() => {}),
    };

    // Create RoomHandlers instance with all required domain handlers
    roomHandlers = new RoomHandlers(
      mockRoomService,
      mockRoomSessionManager,
      mockRoomLifecycleHandler,
      mockRoomMembershipHandler,
      mockApprovalWorkflowHandler
    );
  });

  describe('Coordination Logic', () => {
    it('should create instance with all required domain handler dependencies', () => {
      expect(roomHandlers).toBeInstanceOf(RoomHandlers);
    });

    it('should delegate HTTP room creation to RoomLifecycleHandler', () => {
      const mockReq = {} as any;
      const mockRes = {} as any;

      roomHandlers.handleCreateRoomHttp(mockReq, mockRes);

      expect(mockRoomLifecycleHandler.handleCreateRoomHttp).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should delegate HTTP room leaving to RoomLifecycleHandler', () => {
      const mockReq = {} as any;
      const mockRes = {} as any;

      roomHandlers.handleLeaveRoomHttp(mockReq, mockRes);

      expect(mockRoomLifecycleHandler.handleLeaveRoomHttp).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should handle health check requests', () => {
      const mockReq = {} as any;
      const mockRes = {
        json: jest.fn(() => {}),
        status: jest.fn(() => mockRes),
      } as any;

      roomHandlers.getHealthCheck(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should handle room list requests', () => {
      const mockReq = {} as any;
      const mockRes = {
        json: jest.fn(() => {}),
      } as any;

      const mockRoomList = [{ id: 'room1', name: 'Test Room' }];
      mockRoomService.getAllRooms.mockReturnValue(mockRoomList);

      roomHandlers.getRoomList(mockReq, mockRes);

      expect(mockRoomService.getAllRooms).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(mockRoomList);
    });
  });

  describe('Socket Event Coordination', () => {
    beforeEach(() => {
      // Setup common session mock
      mockRoomSessionManager.getRoomSession.mockReturnValue({
        roomId: 'test-room',
        userId: 'test-user'
      });

      // Setup common room mock
      mockRoomService.getRoom.mockReturnValue({
        id: 'test-room',
        name: 'Test Room',
        users: new Map([
          ['test-user', {
            id: 'test-user',
            username: 'Test User',
            role: 'band_member',
            currentInstrument: 'piano',
            currentCategory: 'keyboard'
          }]
        ]),
        pendingMembers: new Map(),
        metronome: { bpm: 120, lastTickTimestamp: Date.now() }
      } as any);
    });

    it('should delegate ownership transfer to RoomMembershipHandler', () => {
      const transferData = {
        newOwnerId: 'new-owner'
      };

      roomHandlers.handleTransferOwnership(mockSocket, transferData);

      expect(mockRoomMembershipHandler.handleTransferOwnership).toHaveBeenCalledWith(mockSocket, transferData);
    });

    it('should delegate namespace ownership transfer to RoomMembershipHandler', () => {
      const transferData = {
        newOwnerId: 'new-owner'
      };
      const mockNamespace = {
        emit: jest.fn(() => {}),
        name: '/room/test-room'
      } as any;

      roomHandlers.handleTransferOwnershipNamespace(mockSocket, transferData, mockNamespace);

      expect(mockRoomMembershipHandler.handleTransferOwnershipNamespace).toHaveBeenCalledWith(mockSocket, transferData, mockNamespace);
    });

    it('should coordinate disconnection between approval workflow and lifecycle handlers', () => {
      // Test pending member disconnection
      mockRoomService.getRoom.mockReturnValue({
        id: 'test-room',
        users: new Map(),
        pendingMembers: new Map([
          ['test-user', {
            id: 'test-user',
            username: 'Test User'
          }]
        ])
      } as any);

      roomHandlers.handleDisconnect(mockSocket);

      expect(mockApprovalWorkflowHandler.handleApprovalDisconnect).toHaveBeenCalledWith(mockSocket);
      expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith('test-socket-id');
    });

    it('should coordinate disconnection for regular members', () => {
      // Test regular member disconnection
      mockRoomService.getRoom.mockReturnValue({
        id: 'test-room',
        users: new Map([
          ['test-user', {
            id: 'test-user',
            username: 'Test User'
          }]
        ]),
        pendingMembers: new Map()
      } as any);

      roomHandlers.handleDisconnect(mockSocket);

      expect(mockRoomLifecycleHandler.handleLeaveRoom).toHaveBeenCalledWith(mockSocket, false);
      expect(mockRoomSessionManager.removeSession).toHaveBeenCalledWith('test-socket-id');
    });

    it('should handle join room namespace by setting session and delegating to lifecycle handler', () => {
      const joinData = {
        roomId: 'test-room',
        userId: 'test-user'
      };

      roomHandlers.handleJoinRoomNamespace(mockSocket, joinData);

      expect(mockRoomSessionManager.setRoomSession).toHaveBeenCalledWith('test-room', 'test-socket-id', {
        roomId: 'test-room',
        userId: 'test-user'
      });
      expect(mockRoomLifecycleHandler.handleJoinRoom).toHaveBeenCalledWith(mockSocket, joinData);
    });
  });

  // Note: Member management delegation tests removed as functionality moved to RoomMembershipHandler
  // These tests are now covered in RoomMembershipHandler.test.ts
  
  // Note: Synth parameter handling has been moved to AudioRoutingHandler
  // These tests are now covered in AudioRoutingHandler.test.ts
});