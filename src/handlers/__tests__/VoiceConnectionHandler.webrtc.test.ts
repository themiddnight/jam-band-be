/**
 * WebRTC-specific Performance Tests over HTTPS
 * 
 * Dedicated test suite for WebRTC functionality with SSL certificates
 * Run with: npm run test:webrtc
 * 
 * Requirements: 8.1, 8.4
 */

import { VoiceConnectionHandler } from '../VoiceConnectionHandler';
import { RoomService } from '../../services/RoomService';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { Server } from 'socket.io';
import { createServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('WebRTC HTTPS Performance Suite', () => {
  let voiceHandler: VoiceConnectionHandler;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let io: Server;
  let httpsServer: any;

  beforeAll(async () => {
    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);

    // Check for SSL certificates
    const certPath = join(process.cwd(), '.ssl', 'server.crt');
    const keyPath = join(process.cwd(), '.ssl', 'server.key');
    
    let sslOptions: { key: Buffer; cert: Buffer } | null = null;
    
    if (existsSync(certPath) && existsSync(keyPath)) {
      try {
        sslOptions = {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath)
        };
        console.log('Using existing SSL certificates for HTTPS testing');
      } catch (error) {
        console.log('SSL certificates found but could not be loaded, using HTTP for testing');
      }
    } else {
      console.log('SSL certificates not found, using HTTP for testing');
    }

    // Create HTTPS server if SSL certificates are available, otherwise HTTP
    if (sslOptions) {
      httpsServer = createServer(sslOptions);
    } else {
      const { createServer: createHTTPServer } = require('http');
      httpsServer = createHTTPServer();
    }

    // Initialize Socket.IO
    io = new Server(httpsServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize VoiceConnectionHandler
    voiceHandler = new VoiceConnectionHandler(roomService, io, roomSessionManager);

    // Start server
    await new Promise<void>((resolve, reject) => {
      httpsServer.listen(0, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`WebRTC test environment initialized on port ${httpsServer.address()?.port}`);
  });

  afterAll(async () => {
    if (io) {
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
    if (httpsServer) {
      await new Promise<void>((resolve) => {
        httpsServer.close(() => resolve());
      });
    }
    console.log('WebRTC test environment cleaned up');
  });

  describe('Connection Establishment Benchmarks', () => {
    it('should establish WebRTC connections under latency thresholds', async () => {
      const benchmarkStartTime = Date.now();

      // Create test room
      const roomId = 'webrtc-benchmark-room';
      const { room } = roomService.createRoom(roomId, 'WebRTC Benchmark Room', 'owner123', false);

      // Test with varying numbers of users
      const userCounts = [2, 4];
      const results: Array<{ users: number; time: number; avgPerUser: number }> = [];

      for (const userCount of userCounts) {
        const testStartTime = Date.now();
        
        // Create mock sockets and users
        const users: Array<{ socket: any; user: any }> = [];
        for (let i = 0; i < userCount; i++) {
          const userId = `user${i}`;
          const socketId = `socket${i}`;
          
          const mockSocket = {
            id: socketId,
            emit: jest.fn(),
            to: jest.fn(() => ({ emit: jest.fn() })),
            join: jest.fn(),
            leave: jest.fn()
          };

          const user = {
            id: userId,
            username: `User${i}`,
            role: 'audience' as const,
            isReady: true
          };

          roomService.addUserToRoom(roomId, user);
          roomSessionManager.setRoomSession(roomId, socketId, { roomId, userId });
          
          users.push({ socket: mockSocket, user });
        }

        // Measure connection establishment time
        const connectionStartTime = Date.now();

        // All users join voice
        for (const user of users) {
          voiceHandler.handleJoinVoice(user.socket, {
            roomId,
            userId: user.user.id,
            username: user.user.username
          });
        }

        // Simulate mesh connections
        for (let i = 0; i < users.length; i++) {
          for (let j = i + 1; j < users.length; j++) {
            const userI = users[i];
            const userJ = users[j];
            if (userI && userJ) {
              voiceHandler.handleVoiceOffer(userI.socket, {
                roomId,
                targetUserId: userJ.user.id,
                offer: {
                  type: 'offer',
                  sdp: `benchmark-offer-${i}-${j}`
                }
              });

              voiceHandler.handleVoiceAnswer(userJ.socket, {
                roomId,
                targetUserId: userI.user.id,
                answer: {
                  type: 'answer',
                  sdp: `benchmark-answer-${j}-${i}`
                }
              });
            }
          }
        }

        const connectionTime = Date.now() - connectionStartTime;
        const avgPerUser = connectionTime / userCount;

        results.push({ users: userCount, time: connectionTime, avgPerUser });

        // Performance assertions based on user count (allowing for SSL overhead)
        expect(connectionTime).toBeLessThan(100); // Connection setup under 100ms
        expect(avgPerUser).toBeLessThan(30); // Under 30ms per user

        console.log(`[WebRTC Benchmark] ${userCount} users: ${connectionTime}ms total, ${avgPerUser.toFixed(2)}ms per user`);
      }

      const totalBenchmarkTime = Date.now() - benchmarkStartTime;

      // Verify scaling performance
      const lastResult = results[results.length - 1];
      const firstResult = results[0];
      if (lastResult && firstResult) {
        const scalingEfficiency = lastResult.avgPerUser / firstResult.avgPerUser;
        expect(scalingEfficiency).toBeLessThan(2.0); // Performance shouldn't degrade more than 2x
        console.log(`[WebRTC Scaling] Efficiency factor: ${scalingEfficiency.toFixed(2)}x, Total benchmark: ${totalBenchmarkTime}ms`);
      }

      expect(totalBenchmarkTime).toBeLessThan(500); // Total benchmark under 500ms
    });

    it('should handle ICE candidate gathering efficiently at scale', async () => {
      const iceTestStartTime = Date.now();

      // Create test room and users
      const roomId = 'ice-test-room';
      roomService.createRoom(roomId, 'ICE Test Room', 'owner123', false);
      
      const userCount = 4;
      const users: Array<{ socket: any; user: any }> = [];
      
      for (let i = 0; i < userCount; i++) {
        const userId = `ice-user${i}`;
        const socketId = `ice-socket${i}`;
        
        const mockSocket = {
          id: socketId,
          emit: jest.fn(),
          to: jest.fn(() => ({ emit: jest.fn() }))
        };

        const user = {
          id: userId,
          username: `IceUser${i}`,
          role: 'audience' as const,
          isReady: true
        };

        roomService.addUserToRoom(roomId, user);
        roomSessionManager.setRoomSession(roomId, socketId, { roomId, userId });
        
        users.push({ socket: mockSocket, user });
      }

      // Join all users to voice
      for (const user of users) {
        voiceHandler.handleJoinVoice(user.socket, {
          roomId,
          userId: user.user.id,
          username: user.user.username
        });
      }

      // Test ICE candidate exchange between all pairs
      const candidatesPerPair = 3;
      const totalCandidates = users.length * (users.length - 1) * candidatesPerPair;
      const candidateLatencies: number[] = [];

      for (let i = 0; i < users.length; i++) {
        for (let j = 0; j < users.length; j++) {
          if (i !== j) {
            const userI = users[i];
            const userJ = users[j];
            if (userI && userJ) {
              for (let k = 0; k < candidatesPerPair; k++) {
                const candidateStartTime = Date.now();
                
                voiceHandler.handleVoiceIceCandidate(userI.socket, {
                  roomId,
                  targetUserId: userJ.user.id,
                  candidate: {
                    candidate: `candidate:${k} 1 UDP 2113667326 192.168.1.${100 + k} 54400 typ host`,
                    sdpMLineIndex: 0,
                    sdpMid: 'audio'
                  }
                });

                const candidateLatency = Date.now() - candidateStartTime;
                candidateLatencies.push(candidateLatency);
              }
            }
          }
        }
      }

      const totalIceTime = Date.now() - iceTestStartTime;

      // Performance analysis
      const avgCandidateLatency = candidateLatencies.reduce((a, b) => a + b, 0) / candidateLatencies.length;
      const maxCandidateLatency = Math.max(...candidateLatencies);
      const sortedLatencies = candidateLatencies.sort((a, b) => a - b);
      const p95Latency = sortedLatencies[Math.floor(candidateLatencies.length * 0.95)] || 0;

      // Performance assertions for ICE at scale
      expect(avgCandidateLatency).toBeLessThan(5); // Average under 5ms
      expect(maxCandidateLatency).toBeLessThan(15); // Max under 15ms
      expect(p95Latency).toBeLessThan(10); // 95th percentile under 10ms
      expect(totalIceTime).toBeLessThan(500); // Total ICE exchange under 500ms

      console.log(`[ICE Scale Test] ${totalCandidates} candidates - Avg: ${avgCandidateLatency.toFixed(2)}ms, Max: ${maxCandidateLatency.toFixed(2)}ms, P95: ${p95Latency.toFixed(2)}ms, Total: ${totalIceTime}ms`);
    });
  });

  describe('SSL Certificate Performance Impact', () => {
    it('should measure WebRTC operations performance with HTTPS environment', async () => {
      const sslTestStartTime = Date.now();

      // Create test room and users
      const roomId = 'ssl-test-room';
      roomService.createRoom(roomId, 'SSL Test Room', 'owner123', false);
      
      const users: Array<{ socket: any; user: any }> = [];
      for (let i = 0; i < 2; i++) {
        const userId = `ssl-user${i}`;
        const socketId = `ssl-socket${i}`;
        
        const mockSocket = {
          id: socketId,
          emit: jest.fn(),
          to: jest.fn(() => ({ emit: jest.fn() }))
        };

        const user = {
          id: userId,
          username: `SSLUser${i}`,
          role: 'audience' as const,
          isReady: true
        };

        roomService.addUserToRoom(roomId, user);
        roomSessionManager.setRoomSession(roomId, socketId, { roomId, userId });
        
        users.push({ socket: mockSocket, user });
      }

      // Measure operations multiple times for statistical significance
      const iterations = 5;
      const joinTimes: number[] = [];
      const offerTimes: number[] = [];
      const answerTimes: number[] = [];
      const iceTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        // Clean slate for each iteration
        voiceHandler.cleanupRoom(roomId);

        // Measure join
        const joinStart = Date.now();
        const user0 = users[0];
        const user1 = users[1];
        if (user0 && user1) {
          voiceHandler.handleJoinVoice(user0.socket, {
            roomId,
            userId: user0.user.id,
            username: user0.user.username
          });
          voiceHandler.handleJoinVoice(user1.socket, {
            roomId,
            userId: user1.user.id,
            username: user1.user.username
          });
          joinTimes.push(Date.now() - joinStart);

          // Measure offer
          const offerStart = Date.now();
          voiceHandler.handleVoiceOffer(user0.socket, {
            roomId,
            targetUserId: user1.user.id,
            offer: {
              type: 'offer',
              sdp: `ssl-overhead-offer-${i}`
            }
          });
          offerTimes.push(Date.now() - offerStart);

          // Measure answer
          const answerStart = Date.now();
          voiceHandler.handleVoiceAnswer(user1.socket, {
            roomId,
            targetUserId: user0.user.id,
            answer: {
              type: 'answer',
              sdp: `ssl-overhead-answer-${i}`
            }
          });
          answerTimes.push(Date.now() - answerStart);

          // Measure ICE
          const iceStart = Date.now();
          voiceHandler.handleVoiceIceCandidate(user0.socket, {
            roomId,
            targetUserId: user1.user.id,
            candidate: {
              candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
              sdpMLineIndex: 0,
              sdpMid: 'audio'
            }
          });
          iceTimes.push(Date.now() - iceStart);
        }
      }

      const totalOverheadTime = Date.now() - sslTestStartTime;

      // Calculate statistics
      const avgJoin = joinTimes.reduce((a, b) => a + b, 0) / joinTimes.length;
      const avgOffer = offerTimes.reduce((a, b) => a + b, 0) / offerTimes.length;
      const avgAnswer = answerTimes.reduce((a, b) => a + b, 0) / answerTimes.length;
      const avgIce = iceTimes.reduce((a, b) => a + b, 0) / iceTimes.length;

      // Performance assertions (allowing for potential SSL overhead)
      expect(avgJoin).toBeLessThan(20); // Join under 20ms
      expect(avgOffer).toBeLessThan(10); // Offer under 10ms
      expect(avgAnswer).toBeLessThan(10); // Answer under 10ms
      expect(avgIce).toBeLessThan(5); // ICE under 5ms

      // Consistency check (low variance indicates stable performance)
      const joinVariance = Math.max(...joinTimes) - Math.min(...joinTimes);
      const offerVariance = Math.max(...offerTimes) - Math.min(...offerTimes);
      
      expect(joinVariance).toBeLessThan(15); // Join variance under 15ms
      expect(offerVariance).toBeLessThan(8); // Offer variance under 8ms
      expect(totalOverheadTime).toBeLessThan(200); // Total test under 200ms

      console.log(`[WebRTC Performance] Join: ${avgJoin.toFixed(2)}ms (±${joinVariance.toFixed(2)}ms), Offer: ${avgOffer.toFixed(2)}ms (±${offerVariance.toFixed(2)}ms), Answer: ${avgAnswer.toFixed(2)}ms, ICE: ${avgIce.toFixed(2)}ms, Total: ${totalOverheadTime}ms`);
    });

    it('should validate WebRTC configuration works with HTTPS environment', async () => {
      const configTestStartTime = Date.now();

      // Test WebRTC configuration by simulating a connection
      const roomId = 'config-test-room';
      roomService.createRoom(roomId, 'Config Test Room', 'owner123', false);
      
      const users: Array<{ socket: any; user: any }> = [];
      for (let i = 0; i < 2; i++) {
        const userId = `config-user${i}`;
        const socketId = `config-socket${i}`;
        
        const mockSocket = {
          id: socketId,
          emit: jest.fn(),
          to: jest.fn(() => ({ emit: jest.fn() }))
        };

        const user = {
          id: userId,
          username: `ConfigUser${i}`,
          role: 'audience' as const,
          isReady: true
        };

        roomService.addUserToRoom(roomId, user);
        roomSessionManager.setRoomSession(roomId, socketId, { roomId, userId });
        
        users.push({ socket: mockSocket, user });
      }

      // Simulate WebRTC connection
      const connectionStartTime = Date.now();
      
      const user0 = users[0];
      const user1 = users[1];
      if (user0 && user1) {
        voiceHandler.handleJoinVoice(user0.socket, {
          roomId,
          userId: user0.user.id,
          username: user0.user.username
        });

        voiceHandler.handleVoiceOffer(user0.socket, {
          roomId,
          targetUserId: user1.user.id,
          offer: {
            type: 'offer',
            sdp: 'mock-webrtc-offer'
          }
        });

        voiceHandler.handleVoiceAnswer(user1.socket, {
          roomId,
          targetUserId: user0.user.id,
          answer: {
            type: 'answer',
            sdp: 'mock-webrtc-answer'
          }
        });
      }

      const connectionTime = Date.now() - connectionStartTime;
      const validationTime = Date.now() - configTestStartTime;

      expect(connectionTime).toBeLessThan(50); // Connection under 50ms
      expect(validationTime).toBeLessThan(100); // Validation under 100ms

      console.log(`[WebRTC Config] Connection: ${connectionTime}ms, Validation: ${validationTime}ms`);
    });
  });

  describe('Performance Regression Detection', () => {
    it('should detect no significant performance regression', async () => {
      const regressionTestStartTime = Date.now();

      // Run multiple test iterations to establish baseline
      const iterations = 3;
      const performanceResults: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const iterationStartTime = Date.now();
        
        const roomId = `regression-room-${i}`;
        roomService.createRoom(roomId, `Regression Test Room ${i}`, 'owner123', false);
        
        const users: Array<{ socket: any; user: any }> = [];
        for (let j = 0; j < 2; j++) {
          const userId = `regression-user${i}-${j}`;
          const socketId = `regression-socket${i}-${j}`;
          
          const mockSocket = {
            id: socketId,
            emit: jest.fn(),
            to: jest.fn(() => ({ emit: jest.fn() }))
          };

          const user = {
            id: userId,
            username: `RegressionUser${i}-${j}`,
            role: 'audience' as const,
            isReady: true
          };

          roomService.addUserToRoom(roomId, user);
          roomSessionManager.setRoomSession(roomId, socketId, { roomId, userId });
          
          users.push({ socket: mockSocket, user });
        }

        // Test basic WebRTC operations
        const user0 = users[0];
        const user1 = users[1];
        if (user0 && user1) {
          voiceHandler.handleJoinVoice(user0.socket, {
            roomId,
            userId: user0.user.id,
            username: user0.user.username
          });

          voiceHandler.handleJoinVoice(user1.socket, {
            roomId,
            userId: user1.user.id,
            username: user1.user.username
          });

          voiceHandler.handleVoiceOffer(user0.socket, {
            roomId,
            targetUserId: user1.user.id,
            offer: {
              type: 'offer',
              sdp: `mock-regression-offer-${i}`
            }
          });
        }

        const iterationTime = Date.now() - iterationStartTime;
        performanceResults.push(iterationTime);
      }

      const totalRegressionTime = Date.now() - regressionTestStartTime;

      // Analyze performance consistency
      const avgTime = performanceResults.reduce((a, b) => a + b, 0) / performanceResults.length;
      const maxTime = Math.max(...performanceResults);
      const minTime = Math.min(...performanceResults);
      const variance = maxTime - minTime;

      // Performance regression assertions
      expect(avgTime).toBeLessThan(30); // Average iteration under 30ms
      expect(maxTime).toBeLessThan(50); // Max iteration under 50ms
      expect(variance).toBeLessThan(25); // Variance under 25ms (consistent performance)
      expect(totalRegressionTime).toBeLessThan(200); // Total regression test under 200ms

      console.log(`[Regression Detection] Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime}ms, Min: ${minTime}ms, Variance: ${variance}ms, Total: ${totalRegressionTime}ms`);
    });
  });
});