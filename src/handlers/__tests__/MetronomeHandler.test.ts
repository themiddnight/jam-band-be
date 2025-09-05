import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Socket, Namespace } from 'socket.io';
import { MetronomeHandler } from '../domains/room-management/infrastructure/handlers/MetronomeHandler';
import { RoomService } from '../../services/RoomService';
import { MetronomeService } from '../../services/MetronomeService';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { NamespaceManager } from '../../services/NamespaceManager';
import { UpdateMetronomeData, User, UserSession, Room, MetronomeState } from '../../types';

// Mock dependencies
const mockRoomService = {
  getRoom: jest.fn(),
  updateMetronomeBPM: jest.fn(),
  getMetronomeState: jest.fn()
} as jest.Mocked<Partial<RoomService>>;

const mockMetronomeService = {
  updateMetronomeTempo: jest.fn()
} as jest.Mocked<Partial<MetronomeService>>;

const mockRoomSessionManager = {
  getRoomSession: jest.fn()
} as jest.Mocked<Partial<RoomSessionManager>>;

const mockNamespaceManager = {
  getRoomNamespace: jest.fn(),
  createRoomNamespace: jest.fn()
} as jest.Mocked<Partial<NamespaceManager>>;

// Mock socket and namespace
const mockSocket = {
  id: 'socket-123',
  emit: jest.fn()
} as jest.Mocked<Partial<Socket>>;

const mockNamespace = {
  name: '/room-test-room',
  emit: jest.fn()
} as jest.Mocked<Partial<Namespace>>;

describe('MetronomeHandler', () => {
  let metronomeHandler: MetronomeHandler;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create handler instance
    metronomeHandler = new MetronomeHandler(
      mockRoomService as RoomService,
      mockMetronomeService as MetronomeService,
      mockRoomSessionManager as RoomSessionManager,
      mockNamespaceManager as NamespaceManager
    );

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('handleUpdateMetronome', () => {
    const validMetronomeData: UpdateMetronomeData = {
      bpm: 120
    };

    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-123'
    };

    const mockRoomOwner: User = {
      id: 'user-123',
      username: 'RoomOwner',
      role: 'room_owner',
      isReady: true
    };

    const mockRoom: Room = {
      id: 'test-room',
      name: 'Test Room',
      owner: 'user-123',
      users: new Map([['user-123', mockRoomOwner]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 100,
        lastTickTimestamp: Date.now()
      }
    };

    const mockUpdatedRoom: Room = {
      ...mockRoom,
      metronome: {
        bpm: 120,
        lastTickTimestamp: Date.now()
      }
    };

    it('should update metronome BPM when room owner makes request', () => {
      // Arrange
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(mockSession);
      (mockRoomService.getRoom as jest.Mock).mockReturnValue(mockRoom);
      (mockRoomService.updateMetronomeBPM as jest.Mock).mockReturnValue(mockUpdatedRoom);
      (mockNamespaceManager.getRoomNamespace as jest.Mock).mockReturnValue(mockNamespace);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

      // Assert
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-123');
      expect(mockRoomService.getRoom).toHaveBeenCalledWith('test-room');
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('test-room', 120);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('test-room', 120);
      expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
        bpm: 120,
        lastTickTimestamp: expect.any(Number)
      });
    });

    it('should reject metronome update from audience member', () => {
      // Arrange
      const mockAudience: User = {
        id: 'user-789',
        username: 'AudienceMember',
        role: 'audience',
        isReady: true
      };
      const audienceSession = { ...mockSession, userId: 'user-789' };
      const roomWithAudience = {
        ...mockRoom,
        users: new Map([['user-789', mockAudience]])
      };
      
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(audienceSession);
      (mockRoomService.getRoom as jest.Mock).mockReturnValue(roomWithAudience);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

      // Assert
      expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
      expect(mockMetronomeService.updateMetronomeTempo).not.toHaveBeenCalled();
    });

    it('should return early when socket has no session', () => {
      // Arrange
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(null);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, validMetronomeData);

      // Assert
      expect(mockRoomService.getRoom).not.toHaveBeenCalled();
      expect(mockRoomService.updateMetronomeBPM).not.toHaveBeenCalled();
    });
  });

  describe('handleRequestMetronomeState', () => {
    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-123'
    };

    const mockMetronomeState: MetronomeState = {
      bpm: 110,
      lastTickTimestamp: Date.now()
    };

    it('should send metronome state to requesting user', () => {
      // Arrange
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(mockSession);
      (mockRoomService.getMetronomeState as jest.Mock).mockReturnValue(mockMetronomeState);

      // Act
      metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);

      // Assert
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-123');
      expect(mockRoomService.getMetronomeState).toHaveBeenCalledWith('test-room');
      expect(mockSocket.emit).toHaveBeenCalledWith('metronome_state', mockMetronomeState);
    });

    it('should return early when socket has no session', () => {
      // Arrange
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(null);

      // Act
      metronomeHandler.handleRequestMetronomeState(mockSocket as Socket);

      // Assert
      expect(mockRoomService.getMetronomeState).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleUpdateMetronomeNamespace', () => {
    const validMetronomeData: UpdateMetronomeData = {
      bpm: 140
    };

    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-123'
    };

    const mockRoomOwner: User = {
      id: 'user-123',
      username: 'RoomOwner',
      role: 'room_owner',
      isReady: true
    };

    const mockRoom: Room = {
      id: 'test-room',
      name: 'Test Room',
      owner: 'user-123',
      users: new Map([['user-123', mockRoomOwner]]),
      pendingMembers: new Map(),
      isPrivate: false,
      isHidden: false,
      createdAt: new Date(),
      metronome: {
        bpm: 100,
        lastTickTimestamp: Date.now()
      }
    };

    const mockUpdatedRoom: Room = {
      ...mockRoom,
      metronome: {
        bpm: 140,
        lastTickTimestamp: Date.now()
      }
    };

    it('should update metronome BPM through namespace', () => {
      // Arrange
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(mockSession);
      (mockRoomService.getRoom as jest.Mock).mockReturnValue(mockRoom);
      (mockRoomService.updateMetronomeBPM as jest.Mock).mockReturnValue(mockUpdatedRoom);

      // Act
      metronomeHandler.handleUpdateMetronomeNamespace(mockSocket as Socket, validMetronomeData, mockNamespace as Namespace);

      // Assert
      expect(mockRoomService.updateMetronomeBPM).toHaveBeenCalledWith('test-room', 140);
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('test-room', 140);
      expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
        bpm: 140,
        lastTickTimestamp: expect.any(Number)
      });
    });
  });

  describe('handleRequestMetronomeStateNamespace', () => {
    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-123'
    };

    const mockMetronomeState: MetronomeState = {
      bpm: 130,
      lastTickTimestamp: Date.now()
    };

    it('should send metronome state through namespace', () => {
      // Arrange
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(mockSession);
      (mockRoomService.getMetronomeState as jest.Mock).mockReturnValue(mockMetronomeState);

      // Act
      metronomeHandler.handleRequestMetronomeStateNamespace(mockSocket as Socket, mockNamespace as Namespace);

      // Assert
      expect(mockRoomService.getMetronomeState).toHaveBeenCalledWith('test-room');
      expect(mockSocket.emit).toHaveBeenCalledWith('metronome_state', mockMetronomeState);
    });
  });

  describe('Metronome synchronization across room members', () => {
    it('should synchronize metronome updates across all room members', () => {
      // Arrange
      const mockSession: UserSession = { roomId: 'test-room', userId: 'user-1' };
      const mockRoomOwner: User = {
        id: 'user-1',
        username: 'Owner',
        role: 'room_owner',
        isReady: true
      };
      const mockRoom: Room = {
        id: 'test-room',
        name: 'Test Room',
        owner: 'user-1',
        users: new Map([['user-1', mockRoomOwner]]),
        pendingMembers: new Map(),
        isPrivate: false,
        isHidden: false,
        createdAt: new Date(),
        metronome: { bpm: 100, lastTickTimestamp: Date.now() }
      };
      const updatedRoom = {
        ...mockRoom,
        metronome: { bpm: 150, lastTickTimestamp: Date.now() }
      };
      
      (mockRoomSessionManager.getRoomSession as jest.Mock).mockReturnValue(mockSession);
      (mockRoomService.getRoom as jest.Mock).mockReturnValue(mockRoom);
      (mockRoomService.updateMetronomeBPM as jest.Mock).mockReturnValue(updatedRoom);
      (mockNamespaceManager.getRoomNamespace as jest.Mock).mockReturnValue(mockNamespace);

      // Act
      metronomeHandler.handleUpdateMetronome(mockSocket as Socket, { bpm: 150 });

      // Assert
      expect(mockNamespace.emit).toHaveBeenCalledWith('metronome_updated', {
        bpm: 150,
        lastTickTimestamp: expect.any(Number)
      });
      
      // Verify that the metronome service is updated for the entire room
      expect(mockMetronomeService.updateMetronomeTempo).toHaveBeenCalledWith('test-room', 150);
    });
  });
});