import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { NamespaceManager } from '../../src/services/NamespaceManager';
import { NamespaceEventHandlers } from '../../src/handlers/NamespaceEventHandlers';
import { RoomHandlers } from '../../src/handlers/RoomHandlers';
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';

// Mock the LoggingService
jest.mock('../../src/services/LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarning: jest.fn(),
  },
}));

describe('Lobby Latency Monitoring Integration', () => {
  let httpServer: any;
  let io: Server;
  let namespaceManager: NamespaceManager;
  let clientSocket: ClientSocket;
  let serverUrl: string;

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
    const roomSessionManager = new RoomSessionManager();
    const roomService = new RoomService(roomSessionManager);
    const roomHandlers = new RoomHandlers(roomService, io, namespaceManager, roomSessionManager);
    const namespaceEventHandlers = new NamespaceEventHandlers(roomHandlers, roomSessionManager);
    
    // Initialize namespace manager
    namespaceManager = new NamespaceManager(io);
    namespaceManager.setEventHandlers(namespaceEventHandlers);

    // Initialize lobby monitor namespace
    namespaceManager.createLobbyMonitorNamespace();

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
    if (clientSocket) {
      clientSocket.disconnect();
    }
    namespaceManager.shutdown();
    io.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe('Lobby Monitor Namespace', () => {
    it('should allow connection to lobby monitor namespace', async () => {
      return new Promise<void>((resolve, reject) => {
        clientSocket = Client(`${serverUrl}/lobby-monitor`);

        clientSocket.on('connect', () => {
          expect(clientSocket.connected).toBe(true);
          resolve();
        });

        clientSocket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);
      });
    });

    it('should handle ping measurement correctly', async () => {
      return new Promise<void>((resolve, reject) => {
        clientSocket = Client(`${serverUrl}/lobby-monitor`);

        clientSocket.on('connect', () => {
          const pingId = 'test-ping-123';
          const timestamp = Date.now();

          // Set up response handler
          clientSocket.on('ping_response', (data) => {
            expect(data.pingId).toBe(pingId);
            expect(data.timestamp).toBe(timestamp);
            expect(data.serverTimestamp).toBeGreaterThan(timestamp);
            resolve();
          });

          // Send ping measurement
          clientSocket.emit('ping_measurement', {
            pingId,
            timestamp
          });
        });

        clientSocket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Ping response timeout'));
        }, 5000);
      });
    });

    it('should handle multiple concurrent ping measurements', async () => {
      return new Promise<void>((resolve, reject) => {
        clientSocket = Client(`${serverUrl}/lobby-monitor`);

        clientSocket.on('connect', () => {
          const pingIds = ['ping-1', 'ping-2', 'ping-3'];
          const responses = new Set<string>();

          clientSocket.on('ping_response', (data) => {
            responses.add(data.pingId);
            
            if (responses.size === pingIds.length) {
              // All pings received
              expect(responses.size).toBe(3);
              expect(responses.has('ping-1')).toBe(true);
              expect(responses.has('ping-2')).toBe(true);
              expect(responses.has('ping-3')).toBe(true);
              resolve();
            }
          });

          // Send multiple pings
          pingIds.forEach((pingId, index) => {
            setTimeout(() => {
              clientSocket.emit('ping_measurement', {
                pingId,
                timestamp: Date.now()
              });
            }, index * 10); // Stagger slightly
          });
        });

        clientSocket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Multiple ping timeout'));
        }, 5000);
      });
    });

    it('should ignore invalid ping measurements', async () => {
      return new Promise<void>((resolve, reject) => {
        clientSocket = Client(`${serverUrl}/lobby-monitor`);

        clientSocket.on('connect', () => {
          let responseCount = 0;

          clientSocket.on('ping_response', () => {
            responseCount++;
          });

          // Send invalid ping measurements
          clientSocket.emit('ping_measurement', null);
          clientSocket.emit('ping_measurement', {});
          clientSocket.emit('ping_measurement', { pingId: 'test' }); // missing timestamp
          clientSocket.emit('ping_measurement', { timestamp: Date.now() }); // missing pingId

          // Send valid ping measurement
          clientSocket.emit('ping_measurement', {
            pingId: 'valid-ping',
            timestamp: Date.now()
          });

          // Wait a bit and check that only one response was received
          setTimeout(() => {
            expect(responseCount).toBe(1);
            resolve();
          }, 1000);
        });

        clientSocket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Invalid ping test timeout'));
        }, 5000);
      });
    });

    it('should maintain connection independently of room functionality', async () => {
      return new Promise<void>((resolve, reject) => {
        // Connect to lobby monitor
        clientSocket = Client(`${serverUrl}/lobby-monitor`);

        clientSocket.on('connect', () => {
          // Verify lobby connection works
          const pingId = 'independence-test';
          const timestamp = Date.now();

          clientSocket.once('ping_response', (data) => {
            expect(data.pingId).toBe(pingId);
            
            // Create and cleanup a room namespace to simulate room activity
            const roomNamespace = namespaceManager.createRoomNamespace('test-room');
            expect(roomNamespace).toBeDefined();
            
            // Cleanup room namespace
            namespaceManager.cleanupRoomNamespace('test-room');
            
            // Verify lobby connection still works after room operations
            const secondPingId = 'post-room-test';
            const secondTimestamp = Date.now();
            
            clientSocket.once('ping_response', (secondData) => {
              expect(secondData.pingId).toBe(secondPingId);
              resolve();
            });
            
            clientSocket.emit('ping_measurement', {
              pingId: secondPingId,
              timestamp: secondTimestamp
            });
          });

          clientSocket.emit('ping_measurement', {
            pingId,
            timestamp
          });
        });

        clientSocket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Independence test timeout'));
        }, 5000);
      });
    });
  });

  describe('Namespace Isolation', () => {
    it('should isolate lobby monitor from room namespaces', async () => {
      return new Promise<void>((resolve, reject) => {
        // Connect to lobby monitor
        const lobbySocket = Client(`${serverUrl}/lobby-monitor`);
        
        lobbySocket.on('connect', () => {
          // Create room namespace
          const roomNamespace = namespaceManager.createRoomNamespace('isolation-test');
          
          // Connect to room namespace
          const roomSocket = Client(`${serverUrl}/room/isolation-test`);
          
          roomSocket.on('connect', () => {
            let lobbyPingReceived = false;
            let roomEventReceived = false;
            
            // Set up lobby ping response
            lobbySocket.on('ping_response', () => {
              lobbyPingReceived = true;
              checkCompletion();
            });
            
            // Room socket should not receive ping responses
            roomSocket.on('ping_response', () => {
              reject(new Error('Room socket should not receive lobby ping responses'));
            });
            
            // Lobby socket should not receive room events
            lobbySocket.on('room_joined', () => {
              reject(new Error('Lobby socket should not receive room events'));
            });
            
            // Send ping to lobby
            lobbySocket.emit('ping_measurement', {
              pingId: 'isolation-test',
              timestamp: Date.now()
            });
            
            // Simulate room event (this would normally be handled by room handlers)
            roomNamespace.emit('room_joined', { room: { id: 'test' }, users: [] });
            roomEventReceived = true;
            checkCompletion();
            
            function checkCompletion() {
              if (lobbyPingReceived && roomEventReceived) {
                roomSocket.disconnect();
                resolve();
              }
            }
          });
          
          roomSocket.on('connect_error', (error) => {
            reject(error);
          });
        });

        lobbySocket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Isolation test timeout'));
        }, 5000);
      });
    });
  });
});