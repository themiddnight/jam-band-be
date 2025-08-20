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
  },
}));

describe('Multi-Room Isolation Validation', () => {
  let httpServer: any;
  let io: Server;
  let namespaceManager: NamespaceManager;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let metronomeService: MetronomeService;
  let serverUrl: string;

  // Multiple rooms with multiple users each
  const rooms = ['room1', 'room2', 'room3'];
  const usersPerRoom = 3;
  let roomSockets: { [roomId: string]: ClientSocket[] } = {};
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

    // Initialize namespaces for all rooms
    namespaceManager.createLobbyMonitorNamespace();
    rooms.forEach(roomId => {
      namespaceManager.createRoomNamespace(roomId);
      metronomeService.initializeRoomMetronome(roomId, namespaceManager.getNamespace(`/room/${roomId}`)!);
    });

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        const port = (httpServer.address() as any).port;
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });

    // Initialize room sockets
    roomSockets = {};
    rooms.forEach(roomId => {
      roomSockets[roomId] = [];
    });
  });

  afterEach(async () => {
    // Disconnect all clients
    Object.values(roomSockets).flat().forEach(socket => {
      if (socket) {
        socket.disconnect();
      }
    });

    if (lobbySocket) {
      lobbySocket.disconnect();
    }

    // Cleanup services
    metronomeService.shutdown();
    namespaceManager.shutdown();
    io.close();
    
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe('Complete Multi-Room Isolation Validation', () => {
    it('should maintain complete isolation across multiple active rooms with concurrent activity', async () => {
      return new Promise<void>((resolve, reject) => {
        let totalConnections = 0;
        const expectedConnections = rooms.length * usersPerRoom + 1; // +1 for lobby
        let roomEventCounts: { [roomId: string]: { [eventType: string]: number } } = {};
        let crossRoomContamination = false;
        let testPhaseComplete = false;

        // Initialize event counters
        rooms.forEach(roomId => {
          roomEventCounts[roomId] = {
            notes: 0,
            instruments: 0,
            metronome: 0,
            voice: 0,
            disconnects: 0
          };
        });

        const checkConnection = () => {
          totalConnections++;
          if (totalConnections === expectedConnections && !testPhaseComplete) {
            testPhaseComplete = true;
            setTimeout(startConcurrentActivity, 100);
          }
        };

        const startConcurrentActivity = () => {
          // Set up event listeners for all rooms
          rooms.forEach(roomId => {
            roomSockets[roomId].forEach((socket, userIndex) => {
              // Note events
              socket.on('note_played', (data) => {
                if (data.roomId !== roomId) {
                  crossRoomContamination = true;
                  reject(new Error(`Room ${roomId} received note from room ${data.roomId}`));
                  return;
                }
                roomEventCounts[roomId].notes++;
              });

              // Instrument change events
              socket.on('instrument_changed', (data) => {
                if (data.roomId !== roomId) {
                  crossRoomContamination = true;
                  reject(new Error(`Room ${roomId} received instrument change from room ${data.roomId}`));
                  return;
                }
                roomEventCounts[roomId].instruments++;
              });

              // Metronome events
              socket.on('metronome_tick', (data) => {
                if (data.roomId !== roomId) {
                  crossRoomContamination = true;
                  reject(new Error(`Room ${roomId} received metronome tick from room ${data.roomId}`));
                  return;
                }
                roomEventCounts[roomId].metronome++;
              });

              // Voice events
              socket.on('user_joined_voice', (data) => {
                if (data.roomId !== roomId) {
                  crossRoomContamination = true;
                  reject(new Error(`Room ${roomId} received voice event from room ${data.roomId}`));
                  return;
                }
                roomEventCounts[roomId].voice++;
              });

              // Disconnect events
              socket.on('user_left', (data) => {
                if (data.roomId !== roomId) {
                  crossRoomContamination = true;
                  reject(new Error(`Room ${roomId} received disconnect from room ${data.roomId}`));
                  return;
                }
                roomEventCounts[roomId].disconnects++;
              });
            });
          });

          // Generate concurrent activity in all rooms
          setTimeout(() => {
            rooms.forEach((roomId, roomIndex) => {
              const roomSockets = roomSockets[roomId];
              
              // Each room has different activity patterns
              roomSockets.forEach((socket, userIndex) => {
                // Join room first
                socket.emit('join_room', {
                  roomId,
                  userId: `user-${roomId}-${userIndex}`,
                  username: `User ${roomIndex}-${userIndex}`
                });

                // Staggered note playing
                setTimeout(() => {
                  socket.emit('play_note', {
                    roomId,
                    userId: `user-${roomId}-${userIndex}`,
                    note: ['C4', 'E4', 'G4'][userIndex],
                    velocity: 0.8,
                    instrument: ['acoustic_grand_piano', 'electric_guitar_clean', 'analog_poly'][userIndex],
                    timestamp: Date.now()
                  });
                }, userIndex * 100);

                // Staggered instrument changes
                setTimeout(() => {
                  socket.emit('change_instrument', {
                    roomId,
                    userId: `user-${roomId}-${userIndex}`,
                    instrument: ['electric_guitar_clean', 'analog_poly', 'drum_kit'][userIndex],
                    category: ['melodic', 'synthesizer', 'percussion'][userIndex]
                  });
                }, userIndex * 150 + 200);

                // Staggered voice joins
                setTimeout(() => {
                  socket.emit('join_voice', {
                    roomId,
                    userId: `user-${roomId}-${userIndex}`,
                    username: `User ${roomIndex}-${userIndex}`
                  });
                }, userIndex * 200 + 400);
              });

              // Start metronome with different BPM per room
              setTimeout(() => {
                metronomeService.updateMetronomeTempo(roomId, 120 + roomIndex * 20);
              }, 600);

              // Simulate user disconnection in each room
              setTimeout(() => {
                if (roomSockets[0]) {
                  roomSockets[0].disconnect();
                }
              }, 1000 + roomIndex * 100);
            });

            // Verify isolation after all activity
            setTimeout(() => {
              if (!crossRoomContamination) {
                validateIsolation();
              }
            }, 3000);
          }, 100);
        };

        const validateIsolation = () => {
          try {
            // Verify each room received events
            rooms.forEach(roomId => {
              const counts = roomEventCounts[roomId];
              
              // Each room should have received notes from its users
              expect(counts.notes).toBeGreaterThan(0);
              expect(counts.notes).toBeLessThanOrEqual(usersPerRoom * (usersPerRoom - 1)); // Users don't receive their own notes
              
              // Each room should have received instrument changes
              expect(counts.instruments).toBeGreaterThan(0);
              expect(counts.instruments).toBeLessThanOrEqual(usersPerRoom * (usersPerRoom - 1));
              
              // Each room should have received metronome ticks
              expect(counts.metronome).toBeGreaterThan(0);
              
              // Each room should have received voice events
              expect(counts.voice).toBeGreaterThan(0);
              expect(counts.voice).toBeLessThanOrEqual(usersPerRoom * (usersPerRoom - 1));
              
              // Each room should have received exactly one disconnect event
              expect(counts.disconnects).toBe(usersPerRoom - 1); // All remaining users see the disconnect
            });

            // Verify namespace isolation at service level
            const namespaceStats = namespaceManager.getNamespaceStats();
            expect(namespaceStats.totalNamespaces).toBe(rooms.length + 1); // +1 for lobby

            // Verify metronome isolation
            const activeMetronomes = metronomeService.getActiveMetronomes();
            expect(activeMetronomes).toHaveLength(rooms.length);
            rooms.forEach(roomId => {
              expect(activeMetronomes).toContain(roomId);
            });

            // Verify session isolation
            const sessionStats = roomSessionManager.getSessionStats();
            expect(sessionStats.roomBreakdown).toHaveLength(rooms.length);

            resolve();
          } catch (error) {
            reject(error);
          }
        };

        // Connect to lobby
        lobbySocket = Client(`${serverUrl}/lobby-monitor`);
        lobbySocket.on('connect', checkConnection);
        lobbySocket.on('connect_error', reject);

        // Connect users to all rooms
        rooms.forEach(roomId => {
          for (let i = 0; i < usersPerRoom; i++) {
            const socket = Client(`${serverUrl}/room/${roomId}`);
            roomSockets[roomId].push(socket);
            
            socket.on('connect', checkConnection);
            socket.on('connect_error', reject);
          }
        });

        setTimeout(() => {
          reject(new Error('Multi-room isolation test timeout'));
        }, 10000);
      });
    });

    it('should handle room cleanup without affecting other active rooms', async () => {
      return new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const expectedConnections = 6; // 2 users in room1, 2 users in room2, 2 users in room3
        let room1Active = true;
        let room2Active = true;
        let room3Active = true;

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === expectedConnections) {
            startCleanupTest();
          }
        };

        const startCleanupTest = () => {
          // Set up activity monitors
          roomSockets['room1'][1].on('note_played', () => { room1Active = true; });
          roomSockets['room2'][1].on('note_played', () => { room2Active = true; });
          roomSockets['room3'][1].on('note_played', () => { room3Active = true; });

          // Join all rooms
          rooms.forEach(roomId => {
            roomSockets[roomId].forEach((socket, index) => {
              socket.emit('join_room', {
                roomId,
                userId: `user-${roomId}-${index}`,
                username: `User ${roomId} ${index}`
              });
            });
          });

          // Wait for joins, then empty room1 completely
          setTimeout(() => {
            roomSockets['room1'].forEach(socket => socket.disconnect());
            
            // Cleanup room1 namespace
            namespaceManager.cleanupRoomNamespace('room1');
            metronomeService.cleanupRoom('room1');

            // Wait a bit, then test if other rooms are still functional
            setTimeout(() => {
              room2Active = false;
              room3Active = false;

              // Send notes in remaining rooms
              roomSockets['room2'][0].emit('play_note', {
                roomId: 'room2',
                userId: 'user-room2-0',
                note: 'C4',
                velocity: 0.8,
                instrument: 'acoustic_grand_piano',
                timestamp: Date.now()
              });

              roomSockets['room3'][0].emit('play_note', {
                roomId: 'room3',
                userId: 'user-room3-0',
                note: 'E4',
                velocity: 0.8,
                instrument: 'electric_guitar_clean',
                timestamp: Date.now()
              });

              // Verify remaining rooms are still functional
              setTimeout(() => {
                expect(room2Active).toBe(true);
                expect(room3Active).toBe(true);

                // Verify room1 namespace is cleaned up
                expect(namespaceManager.hasNamespace('/room/room1')).toBe(false);
                expect(metronomeService.getRoomMetronome('room1')).toBeUndefined();

                // Verify other rooms are still active
                expect(namespaceManager.hasNamespace('/room/room2')).toBe(true);
                expect(namespaceManager.hasNamespace('/room/room3')).toBe(true);
                expect(metronomeService.getRoomMetronome('room2')).toBeDefined();
                expect(metronomeService.getRoomMetronome('room3')).toBeDefined();

                resolve();
              }, 1000);
            }, 500);
          }, 500);
        };

        // Connect 2 users to each room
        rooms.forEach(roomId => {
          for (let i = 0; i < 2; i++) {
            const socket = Client(`${serverUrl}/room/${roomId}`);
            roomSockets[roomId].push(socket);
            
            socket.on('connect', checkReady);
            socket.on('connect_error', reject);
          }
        });

        setTimeout(() => {
          reject(new Error('Room cleanup test timeout'));
        }, 5000);
      });
    });

    it('should maintain performance isolation under high load', async () => {
      return new Promise<void>((resolve, reject) => {
        const highLoadUsersPerRoom = 5;
        const messageFrequency = 50; // ms between messages
        const testDuration = 2000; // 2 seconds of high load
        let connectionsReady = 0;
        const expectedConnections = rooms.length * highLoadUsersPerRoom;
        let messagesSent: { [roomId: string]: number } = {};
        let messagesReceived: { [roomId: string]: number } = {};
        let crossRoomMessages = 0;

        // Initialize counters
        rooms.forEach(roomId => {
          messagesSent[roomId] = 0;
          messagesReceived[roomId] = 0;
        });

        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === expectedConnections) {
            startHighLoadTest();
          }
        };

        const startHighLoadTest = () => {
          // Set up message listeners
          rooms.forEach(roomId => {
            roomSockets[roomId].forEach(socket => {
              socket.on('note_played', (data) => {
                if (data.roomId === roomId) {
                  messagesReceived[roomId]++;
                } else {
                  crossRoomMessages++;
                }
              });
            });
          });

          // Start high-frequency message sending
          const intervals: NodeJS.Timeout[] = [];
          
          rooms.forEach(roomId => {
            roomSockets[roomId].forEach((socket, userIndex) => {
              const interval = setInterval(() => {
                socket.emit('play_note', {
                  roomId,
                  userId: `user-${roomId}-${userIndex}`,
                  note: 'C4',
                  velocity: Math.random(),
                  instrument: 'acoustic_grand_piano',
                  timestamp: Date.now()
                });
                messagesSent[roomId]++;
              }, messageFrequency);
              
              intervals.push(interval);
            });
          });

          // Stop after test duration and validate
          setTimeout(() => {
            intervals.forEach(interval => clearInterval(interval));
            
            setTimeout(() => {
              try {
                // Verify no cross-room contamination under high load
                expect(crossRoomMessages).toBe(0);

                // Verify each room processed messages
                rooms.forEach(roomId => {
                  expect(messagesSent[roomId]).toBeGreaterThan(0);
                  expect(messagesReceived[roomId]).toBeGreaterThan(0);
                  
                  // Messages received should be less than sent (users don't receive their own)
                  expect(messagesReceived[roomId]).toBeLessThanOrEqual(messagesSent[roomId]);
                });

                // Verify system remained stable
                const namespaceStats = namespaceManager.getNamespaceStats();
                expect(namespaceStats.totalNamespaces).toBe(rooms.length);

                resolve();
              } catch (error) {
                reject(error);
              }
            }, 500);
          }, testDuration);
        };

        // Connect high load users to all rooms
        rooms.forEach(roomId => {
          for (let i = 0; i < highLoadUsersPerRoom; i++) {
            const socket = Client(`${serverUrl}/room/${roomId}`);
            roomSockets[roomId].push(socket);
            
            socket.on('connect', checkReady);
            socket.on('connect_error', reject);
          }
        });

        setTimeout(() => {
          reject(new Error('High load test timeout'));
        }, 8000);
      });
    });
  });
});