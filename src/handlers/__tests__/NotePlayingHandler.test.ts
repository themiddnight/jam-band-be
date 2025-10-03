import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';

import { NotePlayingHandler } from '../../domains/audio-processing/infrastructure/handlers/NotePlayingHandler';
import { RoomService } from '../../services/RoomService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager, NamespaceSession } from '../../services/RoomSessionManager';
import { PlayNoteData, ChangeInstrumentData, Room, User, MetronomeState } from '../../types';

// Mock dependencies
jest.mock('../../services/RoomService');
jest.mock('../../services/NamespaceManager');
jest.mock('../../services/RoomSessionManager');

describe('NotePlayingHandler', () => {
  let notePlayingHandler: NotePlayingHandler;
  let mockRoomService: jest.Mocked<RoomService>;
  let mockNamespaceManager: jest.Mocked<NamespaceManager>;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;
  let mockIo: jest.Mocked<Server>;
  let mockSocket: jest.Mocked<Socket>;
  let mockNamespace: jest.Mocked<Namespace>;

  const mockSession: NamespaceSession = {
    roomId: 'test-room-id',
    userId: 'test-user-id',
    socketId: 'test-socket-id',
    namespacePath: '/room/test-room-id',
    connectedAt: new Date(),
    lastActivity: new Date()
  };

  const mockUser: User = {
    id: 'test-user-id',
    username: 'TestUser',
    role: 'band_member',
    currentInstrument: 'piano',
    currentCategory: 'keyboard',
    isReady: true
  };

  const mockMetronome: MetronomeState = {
    bpm: 120,
    lastTickTimestamp: Date.now()
  };

  const mockRoom: Room = {
    id: 'test-room-id',
    name: 'Test Room',
    users: new Map([['test-user-id', mockUser]]),
    pendingMembers: new Map(),
    owner: 'test-user-id',
    isPrivate: false,
    isHidden: false,
    createdAt: new Date(),
    metronome: mockMetronome,
    roomType: 'perform'
  };

  beforeEach(() => {
    // Create mocks
    mockRoomService = {
      getRoom: jest.fn(),
      updateUserInstrument: jest.fn(),
      getRoomUsers: jest.fn(),
      getPendingMembers: jest.fn(),
    } as any;

    mockNamespaceManager = {
      getRoomNamespace: jest.fn(),
      createRoomNamespace: jest.fn(),
    } as any;

    mockRoomSessionManager = {
      getRoomSession: jest.fn(),
    } as any;

    mockIo = {
      emit: jest.fn(),
    } as any;

    mockSocket = {
      id: 'test-socket-id',
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      broadcast: {
        emit: jest.fn(),
      },
    } as any;

    mockNamespace = {
      name: '/room/test-room-id',
      emit: jest.fn(),
      sockets: new Map([['test-socket-id', mockSocket]]),
    } as any;

    // Setup default mock returns
    mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
    mockRoomService.getRoom.mockReturnValue(mockRoom);
    mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace);
    mockRoomService.getRoomUsers.mockReturnValue([mockUser]);
    mockRoomService.getPendingMembers.mockReturnValue([]);

    // Create handler instance
    notePlayingHandler = new NotePlayingHandler(
      mockRoomService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handlePlayNote', () => {
    it('should handle play note event correctly', () => {
      const playNoteData: PlayNoteData = {
        notes: ['C4', 'E4', 'G4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'note_on',
        isKeyHeld: true
      };

      notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

      // Verify user instrument is updated
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room-id',
        'test-user-id',
        'piano',
        'keyboard'
      );

      // Verify namespace is retrieved
      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');

      // Verify note_played event is emitted to namespace
      expect(mockSocket.to).toHaveBeenCalledWith('/room/test-room-id');
    });

    it('should return early if no session found', () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      const playNoteData: PlayNoteData = {
        notes: ['C4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'note_on',
        isKeyHeld: true
      };

      notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

      expect(mockRoomService.getRoom).not.toHaveBeenCalled();
      expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
    });

    it('should return early if room not found', () => {
      mockRoomService.getRoom.mockReturnValue(undefined);

      const playNoteData: PlayNoteData = {
        notes: ['C4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'note_on',
        isKeyHeld: true
      };

      notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

      expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
    });

    it('should return early if user not found in room', () => {
      const roomWithoutUser: Room = {
        ...mockRoom,
        users: new Map()
      };
      mockRoomService.getRoom.mockReturnValue(roomWithoutUser);

      const playNoteData: PlayNoteData = {
        notes: ['C4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'note_on',
        isKeyHeld: true
      };

      notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

      expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
    });
  });

  describe('handleChangeInstrument', () => {
    it('should handle instrument change correctly', () => {
      const changeInstrumentData: ChangeInstrumentData = {
        instrument: 'guitar',
        category: 'string'
      };

      notePlayingHandler.handleChangeInstrument(mockSocket, changeInstrumentData);

      // Verify user instrument is updated
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room-id',
        'test-user-id',
        'guitar',
        'string'
      );

      // Verify namespace is retrieved for room state update
      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');

      // Verify room state is updated
      expect(mockNamespace.emit).toHaveBeenCalledWith('room_state_updated', expect.objectContaining({
        room: expect.objectContaining({
          id: 'test-room-id',
          users: expect.any(Array),
          pendingMembers: expect.any(Array)
        })
      }));
    });

    it('should return early if no session found', () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      const changeInstrumentData: ChangeInstrumentData = {
        instrument: 'guitar',
        category: 'string'
      };

      notePlayingHandler.handleChangeInstrument(mockSocket, changeInstrumentData);

      expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
    });
  });

  describe('handleStopAllNotes', () => {
    it('should handle stop all notes correctly', () => {
      const stopAllNotesData = {
        instrument: 'piano',
        category: 'keyboard'
      };

      notePlayingHandler.handleStopAllNotes(mockSocket, stopAllNotesData);

      // Verify namespace is retrieved
      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');

      // Verify stop_all_notes event is emitted
      expect(mockSocket.to).toHaveBeenCalledWith('/room/test-room-id');
    });

    it('should return early if no session found', () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

      const stopAllNotesData = {
        instrument: 'piano',
        category: 'keyboard'
      };

      notePlayingHandler.handleStopAllNotes(mockSocket, stopAllNotesData);

      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
    });
  });

  describe('namespace-aware handlers', () => {
    describe('handlePlayNoteNamespace', () => {
      it('should handle play note through namespace correctly', () => {
        const playNoteData: PlayNoteData = {
          notes: ['C4', 'E4'],
          velocity: 0.7,
          instrument: 'synth',
          category: 'synthesizer',
          eventType: 'note_on',
          isKeyHeld: true
        };

        notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);

        // Verify user instrument is updated
        expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
          'test-room-id',
          'test-user-id',
          'synth',
          'synthesizer'
        );

        // Verify note is broadcast to namespace (excluding sender)
        expect(mockSocket.broadcast.emit).toHaveBeenCalledWith('note_played', {
          userId: 'test-user-id',
          username: 'TestUser',
          notes: ['C4', 'E4'],
          velocity: 0.7,
          instrument: 'synth',
          category: 'synthesizer',
          eventType: 'note_on',
          isKeyHeld: true,
          sampleNotes: undefined
        });
      });

      it('should log appropriate messages during namespace handling', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        const playNoteData: PlayNoteData = {
          notes: ['C4'],
          velocity: 0.8,
          instrument: 'piano',
          category: 'keyboard',
          eventType: 'note_on',
          isKeyHeld: true
        };

        notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);

        expect(consoleSpy).toHaveBeenCalledWith('🎵 handlePlayNoteNamespace called:', expect.any(Object));
        expect(consoleSpy).toHaveBeenCalledWith('✅ Broadcasting note to namespace:', expect.any(Object));
        expect(consoleSpy).toHaveBeenCalledWith('📤 Note broadcast completed using socket.broadcast.emit()');

        consoleSpy.mockRestore();
      });

      it('should return early and log error if no session found', () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

        const playNoteData: PlayNoteData = {
          notes: ['C4'],
          velocity: 0.8,
          instrument: 'piano',
          category: 'keyboard',
          eventType: 'note_on',
          isKeyHeld: true
        };

        notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);

        expect(consoleSpy).toHaveBeenCalledWith('❌ No session found for socket:', 'test-socket-id');
        expect(mockSocket.broadcast.emit).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });

    describe('handleChangeInstrumentNamespace', () => {
      it('should handle instrument change through namespace correctly', () => {
        const changeInstrumentData: ChangeInstrumentData = {
          instrument: 'drums',
          category: 'percussion'
        };

        notePlayingHandler.handleChangeInstrumentNamespace(mockSocket, changeInstrumentData, mockNamespace);

        // Verify user instrument is updated
        expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
          'test-room-id',
          'test-user-id',
          'drums',
          'percussion'
        );

        // Verify room state is updated through namespace
        expect(mockNamespace.emit).toHaveBeenCalledWith('room_state_updated', expect.objectContaining({
          room: expect.objectContaining({
            id: 'test-room-id'
          })
        }));
      });
    });

    describe('handleStopAllNotesNamespace', () => {
      it('should handle stop all notes through namespace correctly', () => {
        const stopAllNotesData = {
          instrument: 'guitar',
          category: 'string'
        };

        notePlayingHandler.handleStopAllNotesNamespace(mockSocket, stopAllNotesData, mockNamespace);

        // Verify namespace is retrieved for optimized emit
        expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');
      });
    });
  });

  describe('message batching for performance', () => {
    it('should queue non-critical messages for batching', (done) => {
      // Mock a non-critical event that should be batched
      const mockNonCriticalData = {
        userId: 'test-user-id',
        data: 'test-data'
      };

      // Access private method through any cast for testing
      const handler = notePlayingHandler as any;
      
      // Queue a message
      handler.queueMessage('test-room-id', 'test_event', mockNonCriticalData);

      // Verify message is queued
      expect(handler.messageQueue.get('test-room-id')).toHaveLength(1);

      // Wait for batch processing
      setTimeout(() => {
        // Verify batch timeout was set and cleared
        expect(handler.batchTimeouts.has('test-room-id')).toBe(false);
        done();
      }, 20); // Wait longer than BATCH_INTERVAL (16ms)
    });

    it('should limit queue size to prevent memory leaks', () => {
      const handler = notePlayingHandler as any;
      const roomId = 'test-room-id';

      // Add more messages than MAX_QUEUE_SIZE
      for (let i = 0; i < handler.MAX_QUEUE_SIZE + 10; i++) {
        handler.queueMessage(roomId, 'test_event', { index: i });
      }

      const queue = handler.messageQueue.get(roomId);
      expect(queue.length).toBeLessThanOrEqual(handler.MAX_QUEUE_SIZE);
    });
  });

  describe('namespace creation and error handling', () => {
    it('should create namespace if it does not exist', () => {
      mockNamespaceManager.getRoomNamespace.mockReturnValue(undefined);
      mockNamespaceManager.createRoomNamespace.mockReturnValue(mockNamespace);

      const handler = notePlayingHandler as any;
      const result = handler.getOrCreateRoomNamespace('test-room-id');

      expect(mockNamespaceManager.createRoomNamespace).toHaveBeenCalledWith('test-room-id');
      expect(result).toBe(mockNamespace);
    });

    it('should handle namespace creation errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockNamespaceManager.getRoomNamespace.mockReturnValue(undefined);
      mockNamespaceManager.createRoomNamespace.mockImplementation(() => {
        throw new Error('Namespace creation failed');
      });

      const handler = notePlayingHandler as any;
      const result = handler.getOrCreateRoomNamespace('test-room-id');

      expect(consoleSpy).toHaveBeenCalledWith(
        '❌ Failed to create room namespace for roomId:',
        'test-room-id',
        expect.any(Error)
      );
      expect(result).toBeNull();

      consoleSpy.mockRestore();
    });
  });
});