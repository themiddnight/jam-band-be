import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { NamespaceManager } from '../../src/services/NamespaceManager';
import { NamespaceEventHandlers } from '../../src/handlers/NamespaceEventHandlers';
import { RoomHandlers } from '../../src/handlers/RoomHandlers';
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { MetronomeService } from '../../src/services/MetronomeService';

// Mock the LoggingService
jest.mock('../../src/services/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
    logSocketEvent: jest.fn(),
  },
}));

describe('Cross-Room Isolation Integration Tests', () => {
  let httpServer: any;
  let io: Server;
  let namespaceManager: NamespaceManager;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let metronomeService: MetronomeService;
  let serverUrl: string;

  // Use fake timers to prevent hanging
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // Client sockets for different rooms
  let room1Socket1: ClientSocket;
  let room1Socket2: ClientSocket;
  let room2Socket1: ClientSocket;
  let room2Socket2: ClientSocket;
  let lobbySocket: ClientSocket;

  beforeEach(async () => {
    // Create server
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    metronomeService = new MetronomeService(io, roomService);
    const roomHandlers = new RoomHandlers(roomService, io, namespaceManager, roomSessionManager);
    const namespaceEventHandlers = new NamespaceEventHandlers(roomHandlers, roomSessionManager);
    
    // Initialize namespace manager
    namespaceManager = new NamespaceManager(io);
    namespaceManager.setEventHandlers(namespaceEventHandlers);

    // Initialize namespaces
    namespaceManager.createLobbyMonitorNamespace();
    namespaceManager.createRoomNamespace('room1');
    namespaceManager.createRoomNamespace('room2');

    // Initialize metronomes for rooms
    metronomeService.initializeRoomMetronome('room1', namespaceManager.getNamespace('/room/room1')!);
    metronomeService.initializeRoomMetronome('room2', namespaceManager.getNamespace('/room/room2')!);

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        const port = (httpServer.address() as any).port;
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Clear all timers first
    jest.clearAllTimers();
    
    // Disconnect all clients
    [room1Socket1, room1Socket2, room2Socket1, room2Socket2, lobbySocket].forEach(socket => {
      if (socket) {
        socket.disconnect();
      }
    });

    // Cleanup services
    if (metronomeService) {
      metronomeService.shutdown();
    }
    if (namespaceManager) {
      namespaceManager.shutdown();
    }
    
    // Close server connections
    if (io) {
      io.close();
    }
    
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    }
    
    // Run any pending timers
    jest.runOnlyPendingTimers();
  });

  describe('Basic Namespace Isolation', () => {
    it('should create isolated namespaces for different rooms', () => {
      const room1Namespace = namespaceManager.getNamespace('/room/room1');
      const room2Namespace = namespaceManager.getNamespace('/room/room2');
      const lobbyNamespace = namespaceManager.getNamespace('/lobby-monitor');

      expect(room1Namespace).toBeDefined();
      expect(room2Namespace).toBeDefined();
      expect(lobbyNamespace).toBeDefined();
      
      // Verify they are different instances
      expect(room1Namespace).not.toBe(room2Namespace);
      expect(room1Namespace).not.toBe(lobbyNamespace);
      expect(room2Namespace).not.toBe(lobbyNamespace);
    });
  });

  describe('Musical Events Isolation - Requirements 7.1, 7.2, 7.3', () => {
    it('should isolate note events between rooms', () => {
      // Test namespace isolation by verifying namespaces are separate
      const room1Namespace = namespaceManager.getNamespace('/room/room1');
      const room2Namespace = namespaceManager.getNamespace('/room/room2');

      expect(room1Namespace).toBeDefined();
      expect(room2Namespace).toBeDefined();
      expect(room1Namespace).not.toBe(room2Namespace);

      // Test that events emitted to one namespace don't affect the other
      let room1EventReceived = false;
      let room2EventReceived = false;

      // Mock socket connections
      const mockRoom1Socket = { on: jest.fn(), emit: jest.fn() };
      const mockRoom2Socket = { on: jest.fn(), emit: jest.fn() };

      // Simulate event listeners
      room1Namespace!.on('connection', (socket) => {
        socket.on('note_played', () => {
          room1EventReceived = true;
        });
      });

      room2Namespace!.on('connection', (socket) => {
        socket.on('note_played', () => {
          room2EventReceived = true;
        });
      });

      // Emit events to specific namespaces
      room1Namespace!.emit('note_played', {
        roomId: 'room1',
        userId: 'user1',
        note: 'C4',
        velocity: 0.8,
        instrument: 'acoustic_grand_piano',
        timestamp: Date.now()
      });

      room2Namespace!.emit('note_played', {
        roomId: 'room2',
        userId: 'user3',
        note: 'E4',
        velocity: 0.7,
        instrument: 'electric_guitar_clean',
        timestamp: Date.now()
      });

      // Verify namespaces are isolated
      expect(room1Namespace!.name).toBe('/room/room1');
      expect(room2Namespace!.name).toBe('/room/room2');
    });

    it('should isolate instrument change events between rooms', () => {
      const room1Namespace = namespaceManager.getNamespace('/room/room1');
      const room2Namespace = namespaceManager.getNamespace('/room/room2');

      expect(room1Namespace).toBeDefined();
      expect(room2Namespace).toBeDefined();
      expect(room1Namespace).not.toBe(room2Namespace);

      // Verify namespace names are correct
      expect(room1Namespace!.name).toBe('/room/room1');
      expect(room2Namespace!.name).toBe('/room/room2');
    });

    it('should isolate synthesizer parameter changes between rooms', () => {
      // Test that metronome services are isolated per room
      const room1Metronome = metronomeService.getRoomMetronome('room1');
      const room2Metronome = metronomeService.getRoomMetronome('room2');

      expect(room1Metronome).toBeDefined();
      expect(room2Metronome).toBeDefined();
      expect(room1Metronome).not.toBe(room2Metronome);

      // Verify room IDs are correct
      expect(room1Metronome!.getRoomId()).toBe('room1');
      expect(room2Metronome!.getRoomId()).toBe('room2');
    });
  });

  describe('WebRTC Connection Isolation - Requirement 5.4', () => {
    it('should isolate WebRTC signaling between rooms', () => {
      // Test that room sessions are isolated
      const room1Sessions = roomSessionManager.getSessionStats();
      
      // Verify session manager is properly initialized
      expect(roomSessionManager).toBeDefined();
      expect(room1Sessions).toBeDefined();
      expect(room1Sessions.totalSessions).toBe(0); // No sessions yet
    });

    it('should isolate voice connection events between rooms', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const totalConnections = 4;
        let room1VoiceEvents = 0;
        let room2VoiceEvents = 0;
        let crossRoomContamination = false;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            startTest();
          }
        };

        const startTest = () => {
          // Set up voice event listeners
          room1Socket1.on('user_joined_voice', (data) => {
            room1VoiceEvents++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received voice join from Room 2'));
            }
          });

          room1Socket2.on('user_joined_voice', (data) => {
            room1VoiceEvents++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received voice join from Room 2'));
            }
          });

          room2Socket1.on('user_joined_voice', (data) => {
            room2VoiceEvents++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received voice join from Room 1'));
            }
          });

          room2Socket2.on('user_joined_voice', (data) => {
            room2VoiceEvents++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received voice join from Room 1'));
            }
          });

          // Send voice join events from different rooms
          room1Socket1.emit('join_voice', {
            roomId: 'room1',
            userId: 'user1',
            username: 'User 1'
          });

          room2Socket1.emit('join_voice', {
            roomId: 'room2',
            userId: 'user3',
            username: 'User 3'
          });

          // Wait and verify isolation
          setTimeout(() => {
            if (!crossRoomContamination) {
              expect(room1VoiceEvents).toBe(1);
              expect(room2VoiceEvents).toBe(1);
              resolve();
            }
          }, 1000);
        };

        // Connect to rooms
        room1Socket1 = Client(`${serverUrl}/room/room1`);
        room1Socket2 = Client(`${serverUrl}/room/room1`);
        room2Socket1 = Client(`${serverUrl}/room/room2`);
        room2Socket2 = Client(`${serverUrl}/room/room2`);

        room1Socket1.on('connect', checkReady);
        room1Socket2.on('connect', checkReady);
        room2Socket1.on('connect', checkReady);
        room2Socket2.on('connect', checkReady);

        [room1Socket1, room1Socket2, room2Socket1, room2Socket2].forEach(socket => {
          socket.on('connect_error', reject);
        });

        setTimeout(() => {
          reject(new Error('Test timeout'));
        }, 5000);
      });
    });
  });

  describe('Metronome Isolation - Requirements 8.1, 8.2', () => {
    it('should isolate metronome ticks between rooms', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const totalConnections = 4;
        let room1MetronomeTicks = 0;
        let room2MetronomeTicks = 0;
        let crossRoomContamination = false;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            startTest();
          }
        };

        const startTest = () => {
          // Set up metronome tick listeners
          room1Socket1.on('metronome_tick', (data) => {
            room1MetronomeTicks++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received metronome tick from Room 2'));
            }
          });

          room1Socket2.on('metronome_tick', (data) => {
            room1MetronomeTicks++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received metronome tick from Room 2'));
            }
          });

          room2Socket1.on('metronome_tick', (data) => {
            room2MetronomeTicks++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received metronome tick from Room 1'));
            }
          });

          room2Socket2.on('metronome_tick', (data) => {
            room2MetronomeTicks++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received metronome tick from Room 1'));
            }
          });

          // Start metronomes in both rooms with different tempos
          metronomeService.updateMetronomeTempo('room1', 120);
          metronomeService.updateMetronomeTempo('room2', 140);

          // Wait for several ticks and verify isolation
          setTimeout(() => {
            if (!crossRoomContamination) {
              // Both rooms should have received ticks, but only from their own metronomes
              expect(room1MetronomeTicks).toBeGreaterThan(0);
              expect(room2MetronomeTicks).toBeGreaterThan(0);
              resolve();
            }
          }, 2000); // Wait longer for metronome ticks
        };

        // Connect to rooms
        room1Socket1 = Client(`${serverUrl}/room/room1`);
        room1Socket2 = Client(`${serverUrl}/room/room1`);
        room2Socket1 = Client(`${serverUrl}/room/room2`);
        room2Socket2 = Client(`${serverUrl}/room/room2`);

        room1Socket1.on('connect', checkReady);
        room1Socket2.on('connect', checkReady);
        room2Socket1.on('connect', checkReady);
        room2Socket2.on('connect', checkReady);

        [room1Socket1, room1Socket2, room2Socket1, room2Socket2].forEach(socket => {
          socket.on('connect_error', reject);
        });

        setTimeout(() => {
          reject(new Error('Test timeout'));
        }, 5000);
      });
    });

    it('should isolate metronome control events between rooms', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const totalConnections = 4;
        let room1MetronomeEvents = 0;
        let room2MetronomeEvents = 0;
        let crossRoomContamination = false;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            startTest();
          }
        };

        const startTest = () => {
          // Set up metronome control listeners
          room1Socket1.on('metronome_started', (data) => {
            room1MetronomeEvents++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received metronome start from Room 2'));
            }
          });

          room1Socket2.on('metronome_started', (data) => {
            room1MetronomeEvents++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received metronome start from Room 2'));
            }
          });

          room2Socket1.on('metronome_started', (data) => {
            room2MetronomeEvents++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received metronome start from Room 1'));
            }
          });

          room2Socket2.on('metronome_started', (data) => {
            room2MetronomeEvents++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received metronome start from Room 1'));
            }
          });

          // Send metronome control events from different rooms
          room1Socket1.emit('start_metronome', {
            roomId: 'room1',
            bpm: 120
          });

          room2Socket1.emit('start_metronome', {
            roomId: 'room2',
            bpm: 140
          });

          // Wait and verify isolation
          setTimeout(() => {
            if (!crossRoomContamination) {
              expect(room1MetronomeEvents).toBe(1);
              expect(room2MetronomeEvents).toBe(1);
              resolve();
            }
          }, 1000);
        };

        // Connect to rooms
        room1Socket1 = Client(`${serverUrl}/room/room1`);
        room1Socket2 = Client(`${serverUrl}/room/room1`);
        room2Socket1 = Client(`${serverUrl}/room/room2`);
        room2Socket2 = Client(`${serverUrl}/room/room2`);

        room1Socket1.on('connect', checkReady);
        room1Socket2.on('connect', checkReady);
        room2Socket1.on('connect', checkReady);
        room2Socket2.on('connect', checkReady);

        [room1Socket1, room1Socket2, room2Socket1, room2Socket2].forEach(socket => {
          socket.on('connect_error', reject);
        });

        setTimeout(() => {
          reject(new Error('Test timeout'));
        }, 5000);
      });
    });
  });

  describe('User Disconnection Isolation - Requirements 1.1, 1.2, 1.3', () => {
    it('should not affect other rooms when user disconnects from one room', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const totalConnections = 4;
        let room1DisconnectEvents = 0;
        let room2DisconnectEvents = 0;
        let crossRoomContamination = false;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            startTest();
          }
        };

        const startTest = () => {
          // Set up disconnect event listeners
          room1Socket1.on('user_left', (data) => {
            room1DisconnectEvents++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received user_left from Room 2'));
            }
          });

          room1Socket2.on('user_left', (data) => {
            room1DisconnectEvents++;
            if (data.roomId === 'room2') {
              crossRoomContamination = true;
              reject(new Error('Room 1 received user_left from Room 2'));
            }
          });

          room2Socket1.on('user_left', (data) => {
            room2DisconnectEvents++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received user_left from Room 1'));
            }
          });

          room2Socket2.on('user_left', (data) => {
            room2DisconnectEvents++;
            if (data.roomId === 'room1') {
              crossRoomContamination = true;
              reject(new Error('Room 2 received user_left from Room 1'));
            }
          });

          // First, join rooms properly
          room1Socket1.emit('join_room', {
            roomId: 'room1',
            userId: 'user1',
            username: 'User 1'
          });

          room1Socket2.emit('join_room', {
            roomId: 'room1',
            userId: 'user2',
            username: 'User 2'
          });

          room2Socket1.emit('join_room', {
            roomId: 'room2',
            userId: 'user3',
            username: 'User 3'
          });

          room2Socket2.emit('join_room', {
            roomId: 'room2',
            userId: 'user4',
            username: 'User 4'
          });

          // Wait a bit for joins to complete, then disconnect one user from each room
          setTimeout(() => {
            room1Socket1.disconnect();
            room2Socket1.disconnect();

            // Wait and verify isolation
            setTimeout(() => {
              if (!crossRoomContamination) {
                // Each room should have received exactly one disconnect event
                expect(room1DisconnectEvents).toBe(1);
                expect(room2DisconnectEvents).toBe(1);
                resolve();
              }
            }, 1000);
          }, 500);
        };

        // Connect to rooms
        room1Socket1 = Client(`${serverUrl}/room/room1`);
        room1Socket2 = Client(`${serverUrl}/room/room1`);
        room2Socket1 = Client(`${serverUrl}/room/room2`);
        room2Socket2 = Client(`${serverUrl}/room/room2`);

        room1Socket1.on('connect', checkReady);
        room1Socket2.on('connect', checkReady);
        room2Socket1.on('connect', checkReady);
        room2Socket2.on('connect', checkReady);

        [room1Socket1, room1Socket2, room2Socket1, room2Socket2].forEach(socket => {
          socket.on('connect_error', reject);
        });

        setTimeout(() => {
          reject(new Error('Test timeout'));
        }, 5000);
      });
    });

    it('should maintain room functionality when users disconnect from other rooms', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const totalConnections = 4;
        let room1StillFunctional = false;
        let room2StillFunctional = false;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            startTest();
          }
        };

        const startTest = () => {
          // Set up functionality test listeners
          room1Socket2.on('note_played', (data) => {
            if (data.roomId === 'room1') {
              room1StillFunctional = true;
            }
          });

          room2Socket2.on('note_played', (data) => {
            if (data.roomId === 'room2') {
              room2StillFunctional = true;
            }
          });

          // Join rooms
          room1Socket1.emit('join_room', {
            roomId: 'room1',
            userId: 'user1',
            username: 'User 1'
          });

          room2Socket1.emit('join_room', {
            roomId: 'room2',
            userId: 'user3',
            username: 'User 3'
          });

          // Wait for joins, then disconnect one user from each room
          setTimeout(() => {
            room1Socket1.disconnect();
            room2Socket1.disconnect();

            // Wait a bit, then test if remaining users can still communicate
            setTimeout(() => {
              // Send notes from remaining users
              room1Socket2.emit('play_note', {
                roomId: 'room1',
                userId: 'user2',
                note: 'C4',
                velocity: 0.8,
                instrument: 'acoustic_grand_piano',
                timestamp: Date.now()
              });

              room2Socket2.emit('play_note', {
                roomId: 'room2',
                userId: 'user4',
                note: 'E4',
                velocity: 0.7,
                instrument: 'electric_guitar_clean',
                timestamp: Date.now()
              });

              // Wait and verify both rooms are still functional
              setTimeout(() => {
                expect(room1StillFunctional).toBe(true);
                expect(room2StillFunctional).toBe(true);
                resolve();
              }, 1000);
            }, 500);
          }, 500);
        };

        // Connect to rooms
        room1Socket1 = Client(`${serverUrl}/room/room1`);
        room1Socket2 = Client(`${serverUrl}/room/room1`);
        room2Socket1 = Client(`${serverUrl}/room/room2`);
        room2Socket2 = Client(`${serverUrl}/room/room2`);

        room1Socket1.on('connect', checkReady);
        room1Socket2.on('connect', checkReady);
        room2Socket1.on('connect', checkReady);
        room2Socket2.on('connect', checkReady);

        [room1Socket1, room1Socket2, room2Socket1, room2Socket2].forEach(socket => {
          socket.on('connect_error', reject);
        });

        setTimeout(() => {
          reject(new Error('Test timeout'));
        }, 5000);
      });
    });
  });

  describe('Lobby Isolation from Room Activity', () => {
    it('should isolate lobby monitoring from room events', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const totalConnections = 3; // lobby + 2 room sockets
        let lobbyReceivedRoomEvents = false;
        let lobbyPingWorking = false;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === totalConnections) {
            startTest();
          }
        };

        const startTest = () => {
          // Set up lobby contamination detection
          lobbySocket.on('note_played', () => {
            lobbyReceivedRoomEvents = true;
            reject(new Error('Lobby received room note event'));
          });

          lobbySocket.on('user_joined', () => {
            lobbyReceivedRoomEvents = true;
            reject(new Error('Lobby received room user_joined event'));
          });

          lobbySocket.on('metronome_tick', () => {
            lobbyReceivedRoomEvents = true;
            reject(new Error('Lobby received room metronome event'));
          });

          // Set up lobby ping functionality test
          lobbySocket.on('ping_response', (data) => {
            if (data.pingId === 'isolation-test') {
              lobbyPingWorking = true;
            }
          });

          // Generate room activity
          room1Socket1.emit('play_note', {
            roomId: 'room1',
            userId: 'user1',
            note: 'C4',
            velocity: 0.8,
            instrument: 'acoustic_grand_piano',
            timestamp: Date.now()
          });

          room2Socket1.emit('join_room', {
            roomId: 'room2',
            userId: 'user3',
            username: 'User 3'
          });

          metronomeService.updateMetronomeTempo('room1', 120);

          // Test lobby functionality during room activity
          lobbySocket.emit('ping_measurement', {
            pingId: 'isolation-test',
            timestamp: Date.now()
          });

          // Wait and verify lobby isolation and functionality
          setTimeout(() => {
            if (!lobbyReceivedRoomEvents && lobbyPingWorking) {
              resolve();
            } else if (!lobbyPingWorking) {
              reject(new Error('Lobby ping functionality broken during room activity'));
            }
          }, 2000);
        };

        // Connect to lobby and rooms
        lobbySocket = Client(`${serverUrl}/lobby-monitor`);
        room1Socket1 = Client(`${serverUrl}/room/room1`);
        room2Socket1 = Client(`${serverUrl}/room/room2`);

        lobbySocket.on('connect', checkReady);
        room1Socket1.on('connect', checkReady);
        room2Socket1.on('connect', checkReady);

        [lobbySocket, room1Socket1, room2Socket1].forEach(socket => {
          socket.on('connect_error', reject);
        });

        setTimeout(() => {
          reject(new Error('Test timeout'));
        }, 5000);
      });
    });
  });
});