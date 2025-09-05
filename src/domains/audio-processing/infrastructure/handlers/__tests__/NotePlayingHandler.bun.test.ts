import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';

import { NotePlayingHandler } from '../NotePlayingHandler';
import { RoomService } from '../../../../../services/RoomService';
import { NamespaceManager } from '../../../../../services/NamespaceManager';
import { RoomSessionManager, NamespaceSession } from '../../../../../services/RoomSessionManager';
import { PlayNoteData, ChangeInstrumentData, Room, User, MetronomeState } from '../../../../../types';

describe('NotePlayingHandler - Bun Test Suite', () => {
  let notePlayingHandler: NotePlayingHandler;
  let mockRoomService: any;
  let mockNamespaceManager: any;
  let mockRoomSessionManager: any;
  let mockIo: any;
  let mockSocket: any;
  let mockNamespace: any;

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
    metronome: mockMetronome
  };

  beforeEach(() => {
    // Create comprehensive mocks
    mockRoomService = {
      getRoom: mock(() => mockRoom),
      updateUserInstrument: mock(() => {}),
      getRoomUsers: mock(() => [mockUser]),
      getPendingMembers: mock(() => []),
    };

    mockNamespaceManager = {
      getRoomNamespace: mock(() => mockNamespace),
      createRoomNamespace: mock(() => mockNamespace),
    };

    mockRoomSessionManager = {
      getRoomSession: mock(() => mockSession),
    };

    mockIo = {
      emit: mock(() => {}),
    };

    // Create comprehensive socket mock with all necessary methods
    mockSocket = {
      id: 'test-socket-id',
      emit: mock(() => {}),
      to: mock(() => mockSocket), // Chain-able mock
      broadcast: {
        emit: mock(() => {}),
      },
    };

    // Create comprehensive namespace mock
    mockNamespace = {
      name: '/room/test-room-id',
      emit: mock(() => {}),
      sockets: new Map([['test-socket-id', mockSocket]]),
    };

    // Create handler instance
    notePlayingHandler = new NotePlayingHandler(
      mockRoomService,
      mockIo,
      mockNamespaceManager,
      mockRoomSessionManager
    );
  });

  afterEach(() => {
    // Clear all mocks
    mock.restore();
  });

  describe('Note Playing Functionality', () => {
    describe('handlePlayNote', () => {
      it('should handle single note playing correctly', () => {
        const playNoteData: PlayNoteData = {
          notes: ['C4'],
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

        // Verify socket.to is called for broadcasting
        expect(mockSocket.to).toHaveBeenCalledWith('/room/test-room-id');
      });

      it('should handle chord playing correctly', () => {
        const playNoteData: PlayNoteData = {
          notes: ['C4', 'E4', 'G4'], // C major chord
          velocity: 0.7,
          instrument: 'piano',
          category: 'keyboard',
          eventType: 'note_on',
          isKeyHeld: true
        };

        notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

        expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
          'test-room-id',
          'test-user-id',
          'piano',
          'keyboard'
        );
      });

      it('should handle different instrument types', () => {
        const instruments = [
          { instrument: 'guitar', category: 'string' },
          { instrument: 'drums', category: 'percussion' },
          { instrument: 'synth', category: 'synthesizer' },
          { instrument: 'bass', category: 'string' }
        ];

        instruments.forEach(({ instrument, category }) => {
          const playNoteData: PlayNoteData = {
            notes: ['C4'],
            velocity: 0.8,
            instrument,
            category,
            eventType: 'note_on',
            isKeyHeld: true
          };

          notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

          expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
            'test-room-id',
            'test-user-id',
            instrument,
            category
          );
        });
      });

      it('should handle different event types', () => {
        const eventTypes: Array<'note_on' | 'note_off' | 'sustain_on' | 'sustain_off'> = [
          'note_on', 'note_off', 'sustain_on', 'sustain_off'
        ];

        eventTypes.forEach(eventType => {
          const playNoteData: PlayNoteData = {
            notes: ['C4'],
            velocity: 0.8,
            instrument: 'piano',
            category: 'keyboard',
            eventType,
            isKeyHeld: eventType === 'note_on'
          };

          notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

          expect(mockRoomService.updateUserInstrument).toHaveBeenCalled();
        });
      });

      it('should handle velocity variations correctly', () => {
        const velocities = [0.1, 0.5, 0.8, 1.0];

        velocities.forEach(velocity => {
          const playNoteData: PlayNoteData = {
            notes: ['C4'],
            velocity,
            instrument: 'piano',
            category: 'keyboard',
            eventType: 'note_on',
            isKeyHeld: true
          };

          notePlayingHandler.handlePlayNote(mockSocket, playNoteData);
          expect(mockRoomService.updateUserInstrument).toHaveBeenCalled();
        });
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

      it('should handle stop all notes for different instruments', () => {
        const instruments = [
          { instrument: 'guitar', category: 'string' },
          { instrument: 'drums', category: 'percussion' },
          { instrument: 'synth', category: 'synthesizer' }
        ];

        instruments.forEach(({ instrument, category }) => {
          const stopAllNotesData = { instrument, category };

          notePlayingHandler.handleStopAllNotes(mockSocket, stopAllNotesData);

          expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');
        });
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
  });

  describe('Instrument Change Functionality', () => {
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

      it('should handle multiple instrument changes in sequence', () => {
        const instrumentChanges = [
          { instrument: 'piano', category: 'keyboard' },
          { instrument: 'guitar', category: 'string' },
          { instrument: 'drums', category: 'percussion' },
          { instrument: 'synth', category: 'synthesizer' }
        ];

        instrumentChanges.forEach(({ instrument, category }) => {
          const changeInstrumentData: ChangeInstrumentData = { instrument, category };

          notePlayingHandler.handleChangeInstrument(mockSocket, changeInstrumentData);

          expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
            'test-room-id',
            'test-user-id',
            instrument,
            category
          );
        });
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

      it('should return early if room not found', () => {
        mockRoomService.getRoom.mockReturnValue(undefined);

        const changeInstrumentData: ChangeInstrumentData = {
          instrument: 'guitar',
          category: 'string'
        };

        notePlayingHandler.handleChangeInstrument(mockSocket, changeInstrumentData);

        expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
      });

      it('should return early if user not found in room', () => {
        const roomWithoutUser: Room = {
          ...mockRoom,
          users: new Map()
        };
        mockRoomService.getRoom.mockReturnValue(roomWithoutUser);

        const changeInstrumentData: ChangeInstrumentData = {
          instrument: 'guitar',
          category: 'string'
        };

        notePlayingHandler.handleChangeInstrument(mockSocket, changeInstrumentData);

        expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
      });
    });
  });

  describe('Namespace-Aware Functionality', () => {
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
          isKeyHeld: true
        });
      });

      it('should handle namespace-aware note playing with different instruments', () => {
        const instruments = [
          { instrument: 'piano', category: 'keyboard', notes: ['C4', 'E4', 'G4'] },
          { instrument: 'guitar', category: 'string', notes: ['E2', 'A2', 'D3'] },
          { instrument: 'drums', category: 'percussion', notes: ['kick', 'snare', 'hihat'] },
          { instrument: 'bass', category: 'string', notes: ['E1', 'A1'] }
        ];

        instruments.forEach(({ instrument, category, notes }) => {
          const playNoteData: PlayNoteData = {
            notes,
            velocity: 0.8,
            instrument,
            category,
            eventType: 'note_on',
            isKeyHeld: true
          };

          notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);

          expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
            'test-room-id',
            'test-user-id',
            instrument,
            category
          );

          expect(mockSocket.broadcast.emit).toHaveBeenCalledWith('note_played', expect.objectContaining({
            userId: 'test-user-id',
            username: 'TestUser',
            notes,
            instrument,
            category
          }));
        });
      });

      it('should log appropriate messages during namespace handling', () => {
        const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

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
        const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
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

      it('should return early and log error if room not found', () => {
        const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
        mockRoomService.getRoom.mockReturnValue(undefined);

        const playNoteData: PlayNoteData = {
          notes: ['C4'],
          velocity: 0.8,
          instrument: 'piano',
          category: 'keyboard',
          eventType: 'note_on',
          isKeyHeld: true
        };

        notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);

        expect(consoleSpy).toHaveBeenCalledWith('❌ No room found for roomId:', 'test-room-id');
        expect(mockSocket.broadcast.emit).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });

      it('should return early and log error if user not found', () => {
        const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
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

        notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);

        expect(consoleSpy).toHaveBeenCalledWith('❌ No user found in room for userId:', 'test-user-id');
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

      it('should handle multiple namespace instrument changes', () => {
        const instrumentChanges = [
          { instrument: 'piano', category: 'keyboard' },
          { instrument: 'guitar', category: 'string' },
          { instrument: 'synth', category: 'synthesizer' }
        ];

        instrumentChanges.forEach(({ instrument, category }) => {
          const changeInstrumentData: ChangeInstrumentData = { instrument, category };

          notePlayingHandler.handleChangeInstrumentNamespace(mockSocket, changeInstrumentData, mockNamespace);

          expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
            'test-room-id',
            'test-user-id',
            instrument,
            category
          );

          expect(mockNamespace.emit).toHaveBeenCalledWith('room_state_updated', expect.any(Object));
        });
      });

      it('should return early if no session found', () => {
        mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

        const changeInstrumentData: ChangeInstrumentData = {
          instrument: 'drums',
          category: 'percussion'
        };

        notePlayingHandler.handleChangeInstrumentNamespace(mockSocket, changeInstrumentData, mockNamespace);

        expect(mockRoomService.updateUserInstrument).not.toHaveBeenCalled();
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

      it('should handle namespace stop all notes for different instruments', () => {
        const instruments = [
          { instrument: 'piano', category: 'keyboard' },
          { instrument: 'drums', category: 'percussion' },
          { instrument: 'synth', category: 'synthesizer' }
        ];

        instruments.forEach(({ instrument, category }) => {
          const stopAllNotesData = { instrument, category };

          notePlayingHandler.handleStopAllNotesNamespace(mockSocket, stopAllNotesData, mockNamespace);

          expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');
        });
      });

      it('should return early if no session found', () => {
        mockRoomSessionManager.getRoomSession.mockReturnValue(undefined);

        const stopAllNotesData = {
          instrument: 'guitar',
          category: 'string'
        };

        notePlayingHandler.handleStopAllNotesNamespace(mockSocket, stopAllNotesData, mockNamespace);

        expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      });
    });
  });

  describe('Message Batching for Performance', () => {
    it('should queue non-critical messages for batching', async () => {
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

      // Wait for batch processing using Bun's timer
      await new Promise(resolve => setTimeout(resolve, 20)); // Wait longer than BATCH_INTERVAL (16ms)

      // Verify batch timeout was set and cleared
      expect(handler.batchTimeouts.has('test-room-id')).toBe(false);
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

    it('should group messages by event type and user for batching', async () => {
      const handler = notePlayingHandler as any;
      const roomId = 'test-room-id';

      // Add multiple messages for the same user and event
      for (let i = 0; i < 5; i++) {
        handler.queueMessage(roomId, 'test_event', { userId: 'user1', data: `data${i}` });
      }

      // Add messages for different user
      for (let i = 0; i < 3; i++) {
        handler.queueMessage(roomId, 'test_event', { userId: 'user2', data: `data${i}` });
      }

      // Verify messages are queued
      expect(handler.messageQueue.get(roomId)).toHaveLength(8);

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify namespace emit was called for batched messages
      expect(mockNamespace.emit).toHaveBeenCalled();
    });

    it('should handle immediate vs batched message processing', () => {
      const handler = notePlayingHandler as any;
      const roomId = 'test-room-id';

      // Test immediate message (note_played should be immediate)
      handler.optimizedEmit(mockSocket, roomId, 'note_played', { test: 'data' }, true);
      expect(mockSocket.to).toHaveBeenCalled();

      // Test batched message (non-critical event)
      handler.optimizedEmit(mockSocket, roomId, 'non_critical_event', { test: 'data' }, false);
      expect(handler.messageQueue.get(roomId)).toHaveLength(1);
    });

    it('should handle batch processing with namespace isolation', async () => {
      const handler = notePlayingHandler as any;
      const roomId = 'test-room-id';

      // Queue messages for batching
      handler.queueMessage(roomId, 'batched_event', { userId: 'user1', data: 'test1' });
      handler.queueMessage(roomId, 'batched_event', { userId: 'user1', data: 'test2' });

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 20));

      // Verify namespace emit was called
      expect(mockNamespace.emit).toHaveBeenCalled();
    });

    it('should measure batch processing performance', async () => {
      const handler = notePlayingHandler as any;
      const roomId = 'test-room-id';

      // Queue multiple messages
      for (let i = 0; i < 100; i++) {
        handler.queueMessage(roomId, 'perf_test', { userId: `user${i % 10}`, data: `data${i}` });
      }

      // Measure just the batch processing time
      const start = Bun.nanoseconds();
      
      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 25));

      const duration = Bun.nanoseconds() - start;

      // Verify performance is reasonable (less than 50ms for 100 messages including timeout)
      expect(duration).toBeLessThan(50_000_000); // 50ms in nanoseconds

      // Verify batching occurred
      expect(mockNamespace.emit).toHaveBeenCalled();
    });
  });

  describe('Namespace Creation and Error Handling', () => {
    it('should create namespace if it does not exist', () => {
      mockNamespaceManager.getRoomNamespace.mockReturnValue(undefined);
      mockNamespaceManager.createRoomNamespace.mockReturnValue(mockNamespace);

      const handler = notePlayingHandler as any;
      const result = handler.getOrCreateRoomNamespace('test-room-id');

      expect(mockNamespaceManager.createRoomNamespace).toHaveBeenCalledWith('test-room-id');
      expect(result).toBe(mockNamespace);
    });

    it('should return existing namespace if it exists', () => {
      const handler = notePlayingHandler as any;
      const result = handler.getOrCreateRoomNamespace('test-room-id');

      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-id');
      expect(mockNamespaceManager.createRoomNamespace).not.toHaveBeenCalled();
      expect(result).toBe(mockNamespace);
    });

    it('should handle namespace creation errors gracefully', () => {
      const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
      
      mockNamespaceManager.getRoomNamespace.mockReturnValue(undefined);
      mockNamespaceManager.createRoomNamespace.mockImplementation(() => {
        throw new Error('Namespace creation failed');
      });

      const handler = notePlayingHandler as any;
      const result = handler.getOrCreateRoomNamespace('test-room-id');

      expect(consoleLogSpy).toHaveBeenCalledWith('🔧 Creating room namespace for roomId:', 'test-room-id');
      expect(consoleSpy).toHaveBeenCalledWith(
        '❌ Failed to create room namespace for roomId:',
        'test-room-id',
        expect.any(Error)
      );
      expect(result).toBeNull();

      consoleSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle missing namespace warnings', () => {
      const consoleSpy = spyOn(console, 'warn').mockImplementation(() => {});
      mockNamespaceManager.getRoomNamespace.mockReturnValue(undefined);
      mockNamespaceManager.createRoomNamespace.mockReturnValue(undefined);

      const handler = notePlayingHandler as any;
      
      // First queue a message to ensure there's something to process
      handler.queueMessage('test-room-id', 'test_event', { test: 'data' });
      
      // Then process the batch which should trigger the warning
      handler.processBatch('test-room-id');

      expect(consoleSpy).toHaveBeenCalledWith('Room namespace not found for batch processing:', 'test-room-id');

      consoleSpy.mockRestore();
    });
  });

  describe('Coordination and Integration', () => {
    it('should coordinate note playing with instrument changes', () => {
      // First, change instrument
      const changeInstrumentData: ChangeInstrumentData = {
        instrument: 'guitar',
        category: 'string'
      };

      notePlayingHandler.handleChangeInstrument(mockSocket, changeInstrumentData);

      // Then, play note with new instrument
      const playNoteData: PlayNoteData = {
        notes: ['E2', 'A2', 'D3'],
        velocity: 0.8,
        instrument: 'guitar',
        category: 'string',
        eventType: 'note_on',
        isKeyHeld: true
      };

      notePlayingHandler.handlePlayNote(mockSocket, playNoteData);

      // Verify both operations updated the instrument correctly
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room-id',
        'test-user-id',
        'guitar',
        'string'
      );
    });

    it('should handle rapid note playing sequences', async () => {
      const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
      
      // Measure performance of rapid note sequence
      const start = Bun.nanoseconds();

      notes.forEach((note, index) => {
        const playNoteData: PlayNoteData = {
          notes: [note],
          velocity: 0.8,
          instrument: 'piano',
          category: 'keyboard',
          eventType: 'note_on',
          isKeyHeld: true
        };

        notePlayingHandler.handlePlayNote(mockSocket, playNoteData);
      });

      const duration = Bun.nanoseconds() - start;

      // Verify performance is reasonable for rapid sequences
      expect(duration).toBeLessThan(5_000_000); // 5ms for 8 notes

      // Verify all notes were processed
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledTimes(notes.length);
    });

    it('should handle concurrent users playing notes', () => {
      // Create additional user and session
      const user2: User = {
        id: 'test-user-id-2',
        username: 'TestUser2',
        role: 'band_member',
        currentInstrument: 'guitar',
        currentCategory: 'string',
        isReady: true
      };

      const session2: NamespaceSession = {
        roomId: 'test-room-id',
        userId: 'test-user-id-2',
        socketId: 'test-socket-id-2',
        namespacePath: '/room/test-room-id',
        connectedAt: new Date(),
        lastActivity: new Date()
      };

      const roomWithTwoUsers: Room = {
        ...mockRoom,
        users: new Map([
          ['test-user-id', mockUser],
          ['test-user-id-2', user2]
        ])
      };

      const mockSocket2 = {
        id: 'test-socket-id-2',
        emit: mock(() => {}),
        to: mock(() => mockSocket2),
        broadcast: { emit: mock(() => {}) },
      };

      // Setup mocks for second user
      mockRoomService.getRoom.mockReturnValue(roomWithTwoUsers);
      mockRoomSessionManager.getRoomSession
        .mockReturnValueOnce(mockSession) // First call for user 1
        .mockReturnValueOnce(session2);   // Second call for user 2

      // Both users play notes simultaneously
      const playNoteData1: PlayNoteData = {
        notes: ['C4', 'E4', 'G4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'note_on',
        isKeyHeld: true
      };

      const playNoteData2: PlayNoteData = {
        notes: ['E2', 'A2'],
        velocity: 0.7,
        instrument: 'guitar',
        category: 'string',
        eventType: 'note_on',
        isKeyHeld: true
      };

      notePlayingHandler.handlePlayNote(mockSocket, playNoteData1);
      notePlayingHandler.handlePlayNote(mockSocket2 as any, playNoteData2);

      // Verify both users' instruments were updated
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room-id',
        'test-user-id',
        'piano',
        'keyboard'
      );
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room-id',
        'test-user-id-2',
        'guitar',
        'string'
      );
    });

    it('should maintain behavior consistency between regular and namespace handlers', () => {
      const playNoteData: PlayNoteData = {
        notes: ['C4', 'E4', 'G4'],
        velocity: 0.8,
        instrument: 'piano',
        category: 'keyboard',
        eventType: 'note_on',
        isKeyHeld: true
      };

      // Test regular handler
      notePlayingHandler.handlePlayNote(mockSocket, playNoteData);
      const regularCallCount = mockRoomService.updateUserInstrument.mock.calls.length;

      // Reset mocks
      mockRoomService.updateUserInstrument.mockClear();

      // Test namespace handler
      notePlayingHandler.handlePlayNoteNamespace(mockSocket, playNoteData, mockNamespace);
      const namespaceCallCount = mockRoomService.updateUserInstrument.mock.calls.length;

      // Verify both handlers call updateUserInstrument with same parameters
      expect(regularCallCount).toBe(namespaceCallCount);
      expect(mockRoomService.updateUserInstrument).toHaveBeenCalledWith(
        'test-room-id',
        'test-user-id',
        'piano',
        'keyboard'
      );
    });
  });
});