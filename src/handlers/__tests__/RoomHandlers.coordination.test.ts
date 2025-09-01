import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { RoomHandlers } from '../RoomHandlers';
import { RoomService } from '../../services/RoomService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { Server } from 'socket.io';
import { Socket } from 'socket.io';

describe('RoomHandlers Coordination Layer', () => {
  let roomHandlers: RoomHandlers;
  let mockRoomService: any;
  let mockNamespaceManager: any;
  let mockRoomSessionManager: any;
  let mockIo: any;
  let mockSocket: any;

  beforeEach(() => {
    // Create mocks
    mockRoomService = {
      getAllRooms: mock(() => []),
      getRoom: mock(() => null),
      updateUserInstrument: mock(() => {}),
      findUserInRoom: mock(() => null),
      updateMetronomeBPM: mock(() => null),
      transferOwnership: mock(() => null),
    };
    
    mockNamespaceManager = {
      getRoomNamespace: mock(() => null),
      createRoomNamespace: mock(() => null),
    };
    
    mockRoomSessionManager = {
      getRoomSession: mock(() => null),
      setRoomSession: mock(() => {}),
      removeSession: mock(() => {}),
    };
    
    mockIo = {
      emit: mock(() => {}),
    };
    
    mockSocket = {
      id: 'test-socket-id',
      emit: mock(() => {}),
      to: mock(() => mockSocket),
      broadcast: {
        emit: mock(() => {}),
      },
    };

    // Create RoomHandlers instance
    roomHandlers = new RoomHandlers(
      mockRoomService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  describe('Coordination Logic', () => {
    it('should create instance with all required dependencies', () => {
      expect(roomHandlers).toBeInstanceOf(RoomHandlers);
    });

    it('should delegate HTTP room creation to RoomLifecycleHandler', () => {
      const mockReq = {} as any;
      const mockRes = {
        status: mock(() => mockRes),
        json: mock(() => {}),
      } as any;

      roomHandlers.handleCreateRoomHttp(mockReq, mockRes);

      // Should return error when lifecycle handler not available
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Room lifecycle handler not available'
      });
    });

    it('should delegate HTTP room leaving to RoomLifecycleHandler', () => {
      const mockReq = {} as any;
      const mockRes = {
        status: mock(() => mockRes),
        json: mock(() => {}),
      } as any;

      roomHandlers.handleLeaveRoomHttp(mockReq, mockRes);

      // Should return error when lifecycle handler not available
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Room lifecycle handler not available'
      });
    });

    it('should handle health check requests', () => {
      const mockReq = {} as any;
      const mockRes = {
        json: mock(() => {}),
        status: mock(() => mockRes),
      } as any;

      roomHandlers.getHealthCheck(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should handle room list requests', () => {
      const mockReq = {} as any;
      const mockRes = {
        json: mock(() => {}),
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

    it('should handle play note events', () => {
      const playNoteData = {
        notes: ['C4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'noteOn',
        isKeyHeld: true
      };

      roomHandlers.handlePlayNote(mockSocket, playNoteData);

      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room',
        'test-user',
        'piano',
        'keyboard'
      );
    });

    it('should handle instrument changes', () => {
      const changeInstrumentData = {
        instrument: 'guitar',
        category: 'string'
      };

      roomHandlers.handleChangeInstrument(mockSocket, changeInstrumentData);

      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room',
        'test-user',
        'guitar',
        'string'
      );
    });

    it('should handle stop all notes events', () => {
      const stopNotesData = {
        instrument: 'piano',
        category: 'keyboard'
      };

      roomHandlers.handleStopAllNotes(mockSocket, stopNotesData);

      // Should process the event without errors
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('test-socket-id');
    });

    it('should handle chat messages', () => {
      const chatData = {
        message: 'Hello everyone!'
      };

      mockRoomService.findUserInRoom.mockReturnValue({
        id: 'test-user',
        username: 'Test User'
      } as any);

      roomHandlers.handleChatMessage(mockSocket, chatData);

      expect(mockRoomService.findUserInRoom).toHaveBeenCalledWith('test-room', 'test-user');
    });

    it('should handle metronome updates', () => {
      const metronomeData = {
        bpm: 140
      };

      mockRoomService.updateMetronomeBPM.mockReturnValue({
        metronome: { bpm: 140, lastTickTimestamp: Date.now() }
      } as any);

      roomHandlers.handleUpdateMetronome(mockSocket, metronomeData);

      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('test-room', 140);
    });

    it('should handle ownership transfer', () => {
      const transferData = {
        newOwnerId: 'new-owner'
      };

      mockRoomService.transferOwnership.mockReturnValue({
        newOwner: { id: 'new-owner', username: 'New Owner' },
        oldOwner: { id: 'test-user', username: 'Test User' }
      });

      roomHandlers.handleTransferOwnership(mockSocket, transferData);

      expect(mockRoomService.transferOwnership).toHaveBeenCalledWith('test-room', 'new-owner');
    });
  });

  describe('Delegation to Specialized Handlers', () => {
    let mockRoomMembershipHandler: any;

    beforeEach(() => {
      mockRoomMembershipHandler = {
        handleApproveMember: mock(() => {}),
        handleRejectMember: mock(() => {}),
        handleApproveMemberNamespace: mock(() => {}),
        handleRejectMemberNamespace: mock(() => {}),
      };

      // Create new instance with membership handler
      roomHandlers = new RoomHandlers(
        mockRoomService,
        mockIo,
        mockNamespaceManager,
        mockRoomSessionManager,
        undefined, // roomLifecycleHandler
        undefined, // voiceConnectionHandler
        undefined, // audioRoutingHandler
        mockRoomMembershipHandler
      );
    });

    it('should delegate member approval to RoomMembershipHandler', () => {
      const approvalData = { userId: 'user-to-approve' };

      roomHandlers.handleApproveMember(mockSocket, approvalData);

      expect(mockRoomMembershipHandler.handleApproveMember).toHaveBeenCalledWith(
        mockSocket,
        approvalData
      );
    });

    it('should delegate member rejection to RoomMembershipHandler', () => {
      const rejectionData = { userId: 'user-to-reject', message: 'Not suitable' };

      roomHandlers.handleRejectMember(mockSocket, rejectionData);

      expect(mockRoomMembershipHandler.handleRejectMember).toHaveBeenCalledWith(
        mockSocket,
        rejectionData
      );
    });
  });
});