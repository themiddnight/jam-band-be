import { AudioRoutingHandler } from '../domains/audio-processing/infrastructure/handlers/AudioRoutingHandler';
import { RoomService } from '../../services/RoomService';
import { RoomSessionManager, NamespaceSession } from '../../services/RoomSessionManager';
import { NamespaceManager } from '../../services/NamespaceManager';
import { Server } from 'socket.io';
import { Socket, Namespace } from 'socket.io';
import { UpdateSynthParamsData } from '../../types';

// Mock dependencies
jest.mock('../../services/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn()
  }
}));

describe('AudioRoutingHandler', () => {
  let audioRoutingHandler: AudioRoutingHandler;
  let mockRoomService: jest.Mocked<RoomService>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockIo: jest.Mocked<Server>;
  let mockSocket: jest.Mocked<Socket>;
  let mockNamespace: jest.Mocked<Namespace>;

  beforeEach(() => {
    // Create proper mocks
    mockRoomService = {
      getRoom: jest.fn(),
      findUserInRoom: jest.fn()
    } as any;

    mockRoomSessionManager = {
      getRoomSession: jest.fn(),
      findSocketByUserId: jest.fn()
    } as any;

    mockNamespaceManager = {
      getRoomNamespace: jest.fn(),
      createRoomNamespace: jest.fn()
    } as any;

    mockIo = {
      sockets: {
        sockets: new Map()
      }
    } as any;
    
    mockSocket = {
      id: 'socket123',
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      broadcast: { emit: jest.fn() }
    } as any;

    mockNamespace = {
      name: '/room/test-room',
      emit: jest.fn(),
      sockets: new Map()
    } as any;

    audioRoutingHandler = new AudioRoutingHandler(
      mockRoomService,
      mockIo,
      mockRoomSessionManager,
      mockNamespaceManager
    );
  });

  describe('handleUpdateSynthParams', () => {
    it('should handle synth parameter updates correctly', () => {
      // Arrange
      const mockSession: NamespaceSession = { 
        roomId: 'room123', 
        userId: 'user123',
        socketId: 'socket123',
        namespacePath: '/room/room123',
        connectedAt: new Date(),
        lastActivity: new Date()
      };
      const mockRoom = {
        id: 'room123',
        users: new Map([
          ['user123', { 
            id: 'user123', 
            username: 'testuser', 
            currentInstrument: 'synth',
            currentCategory: 'synthesizer'
          }]
        ])
      };
      const synthParams: UpdateSynthParamsData = {
        params: { frequency: 440, resonance: 0.5 }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom as any);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace);

      // Act
      audioRoutingHandler.handleUpdateSynthParams(mockSocket, synthParams);

      // Assert
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket123');
      expect(mockRoomService.getRoom).toHaveBeenCalledWith('room123');
      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('room123');
      expect(mockSocket.to).toHaveBeenCalledWith('/room/test-room');
    });

    it('should return early if no session found', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      // Act
      audioRoutingHandler.handleUpdateSynthParams(mockSocket, { params: {} });

      // Assert
      expect(mockRoomService.getRoom).not.toHaveBeenCalled();
    });

    it('should return early if no room found', () => {
      // Arrange
      const mockSession: NamespaceSession = { 
        roomId: 'room123', 
        userId: 'user123',
        socketId: 'socket123',
        namespacePath: '/room/room123',
        connectedAt: new Date(),
        lastActivity: new Date()
      };
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(undefined);

      // Act
      audioRoutingHandler.handleUpdateSynthParams(mockSocket, { params: {} });

      // Assert
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
    });
  });

  describe('handleRequestSynthParams', () => {
    it('should request synth params from synthesizer users', () => {
      // Arrange
      const mockSession: NamespaceSession = { 
        roomId: 'room123', 
        userId: 'user123',
        socketId: 'socket123',
        namespacePath: '/room/room123',
        connectedAt: new Date(),
        lastActivity: new Date()
      };
      const mockRoom = {
        id: 'room123',
        users: new Map([
          ['user123', { 
            id: 'user123', 
            username: 'requester',
            currentCategory: 'drums'
          }],
          ['user456', { 
            id: 'user456', 
            username: 'synthuser',
            currentCategory: 'synthesizer'
          }]
        ])
      };

      const mockSynthSocket = { emit: jest.fn() } as any;
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom as any);
      mockRoomSessionManager.findSocketByUserId.mockReturnValue('synthSocket456');
      mockIo.sockets.sockets.set('synthSocket456', mockSynthSocket);

      // Act
      audioRoutingHandler.handleRequestSynthParams(mockSocket);

      // Assert
      expect(mockSynthSocket.emit).toHaveBeenCalledWith('request_synth_params_response', {
        requestingUserId: 'user123',
        requestingUsername: 'requester'
      });
    });
  });

  describe('autoRequestSynthParamsForNewUser', () => {
    it('should auto-request synth params for new users', () => {
      // Arrange
      const roomId = 'room123';
      const newUserId = 'newuser123';
      const mockRoom = {
        id: roomId,
        users: new Map([
          ['newuser123', { 
            id: 'newuser123', 
            username: 'newuser'
          }],
          ['synthuser456', { 
            id: 'synthuser456', 
            username: 'synthuser',
            currentCategory: 'synthesizer'
          }]
        ])
      };

      const mockSynthSocket = { emit: jest.fn() } as any;
      mockRoomService.getRoom.mockReturnValue(mockRoom as any);
      mockRoomSessionManager.findSocketByUserId.mockReturnValue('synthSocket456');
      mockIo.sockets.sockets.set('synthSocket456', mockSynthSocket);

      // Act
      audioRoutingHandler.autoRequestSynthParamsForNewUser(mockSocket, roomId, newUserId);

      // Assert
      expect(mockSynthSocket.emit).toHaveBeenCalledWith('auto_send_synth_params_to_new_user', {
        newUserId: 'newuser123',
        newUsername: 'newuser'
      });
    });
  });

  describe('handleUpdateSynthParamsNamespace', () => {
    it('should broadcast synth params through namespace', () => {
      // Arrange
      const mockSession: NamespaceSession = { 
        roomId: 'room123', 
        userId: 'user123',
        socketId: 'socket123',
        namespacePath: '/room/room123',
        connectedAt: new Date(),
        lastActivity: new Date()
      };
      const mockRoom = {
        id: 'room123',
        users: new Map([
          ['user123', { 
            id: 'user123', 
            username: 'testuser',
            currentInstrument: 'synth',
            currentCategory: 'synthesizer'
          }]
        ])
      };
      const synthParams: UpdateSynthParamsData = {
        params: { frequency: 440 }
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.getRoom.mockReturnValue(mockRoom as any);

      // Act
      audioRoutingHandler.handleUpdateSynthParamsNamespace(mockSocket, synthParams, mockNamespace);

      // Assert
      expect(mockSocket.broadcast.emit).toHaveBeenCalledWith('synth_params_changed', {
        userId: 'user123',
        username: 'testuser',
        instrument: 'synth',
        category: 'synthesizer',
        params: { frequency: 440 }
      });
    });
  });
});