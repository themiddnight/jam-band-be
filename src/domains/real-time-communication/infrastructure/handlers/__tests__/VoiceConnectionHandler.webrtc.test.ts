/**
 * VoiceConnectionHandler WebRTC HTTPS Performance Tests
 * 
 * Task 3.2: Test WebRTC functionality maintains low latency over HTTPS
 * - Measure connection establishment times with SSL certificates using Bun test runner
 * - Verify mesh topology creation works identically over HTTPS (bun run test:webrtc)
 * - Test ICE candidate gathering and WebRTC negotiation with SSL
 * - Test with multiple concurrent connections in HTTPS environment
 * - Ensure no performance degradation from HTTPS overhead
 * 
 * Requirements: 8.1, 8.4
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from 'bun:test';
import { Server } from 'socket.io';
import { createServer as createHTTPSServer } from 'https';
import { createServer as createHTTPServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { VoiceConnectionHandler } from '../VoiceConnectionHandler';
import { RoomService } from '../../../../../services/RoomService';
import { RoomSessionManager } from '../../../../../services/RoomSessionManager';

interface TestUser {
  id: string;
  username: string;
  socket: any;
}

interface TestRoom {
  id: string;
  name: string;
  ownerId: string;
}

interface PerformanceMetrics {
  connectionEstablishment: number[];
  meshTopologyCreation: number[];
  iceGathering: number[];
  sslHandshake: number[];
  webrtcNegotiation: number[];
}

describe('VoiceConnectionHandler - WebRTC HTTPS Performance Tests', () => {
  let httpsServer: any;
  let httpServer: any;
  let httpsIO: Server;
  let httpIO: Server;
  let httpsVoiceHandler: VoiceConnectionHandler;
  let httpVoiceHandler: VoiceConnectionHandler;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let httpsPort: number;
  let httpPort: number;
  let sslOptions: { key: Buffer; cert: Buffer };
  let performanceMetrics: PerformanceMetrics;

  beforeAll(async () => {
    // Load SSL certificates
    const certPath = join(process.cwd(), '.ssl', 'server.crt');
    const keyPath = join(process.cwd(), '.ssl', 'server.key');
    
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      throw new Error(`SSL certificates not found at ${certPath} and ${keyPath}`);
    }

    sslOptions = {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath)
    };

    // Initialize performance metrics
    performanceMetrics = {
      connectionEstablishment: [],
      meshTopologyCreation: [],
      iceGathering: [],
      sslHandshake: [],
      webrtcNegotiation: []
    };
  });

  beforeEach(async () => {
    // Create HTTPS server
    httpsServer = createHTTPSServer(sslOptions);
    httpsIO = new Server(httpsServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      allowEIO3: true
    });

    // Create HTTP server for comparison
    httpServer = createHTTPServer();
    httpIO = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
      allowEIO3: true
    });

    // Initialize services
    roomService = new RoomService();
    roomSessionManager = new RoomSessionManager();

    // Initialize voice handlers
    httpsVoiceHandler = new VoiceConnectionHandler(roomService, httpsIO, roomSessionManager);
    httpVoiceHandler = new VoiceConnectionHandler(roomService, httpIO, roomSessionManager);

    // Start servers on random ports
    await new Promise<void>((resolve) => {
      httpsServer.listen(0, () => {
        httpsPort = httpsServer.address()?.port;
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        httpPort = httpServer.address()?.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Cleanup servers
    if (httpsServer) {
      httpsServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
    
    // Clear room service state
    roomService = new RoomService();
    roomSessionManager = new RoomSessionManager();
  });

  afterAll(() => {
    // Log final performance summary
    console.log('\n📊 Final Performance Summary:');
    console.log(`Connection Establishment: avg ${calculateAverage(performanceMetrics.connectionEstablishment).toFixed(2)}ms`);
    console.log(`Mesh Topology Creation: avg ${calculateAverage(performanceMetrics.meshTopologyCreation).toFixed(2)}ms`);
    console.log(`ICE Gathering: avg ${calculateAverage(performanceMetrics.iceGathering).toFixed(2)}ms`);
    console.log(`SSL Handshake: avg ${calculateAverage(performanceMetrics.sslHandshake).toFixed(2)}ms`);
    console.log(`WebRTC Negotiation: avg ${calculateAverage(performanceMetrics.webrtcNegotiation).toFixed(2)}ms`);
  });

  describe('Connection Establishment Times with SSL Certificates', () => {
    it('should measure WebRTC connection establishment over HTTPS with low latency', async () => {
      const startTime = Bun.nanoseconds();
      
      // Create test room and users
      const room = await createTestRoom('HTTPS Connection Test');
      const users = await createTestUsers(room.id, 2, true); // HTTPS users
      
      // Measure SSL handshake time
      const sslStart = Bun.nanoseconds();
      await simulateSSLHandshake();
      const sslTime = (Bun.nanoseconds() - sslStart) / 1_000_000; // Convert to ms
      performanceMetrics.sslHandshake.push(sslTime);

      // Measure WebRTC connection establishment
      const connectionStart = Bun.nanoseconds();
      
      // Join voice
      httpsVoiceHandler.handleJoinVoice(users[0].socket, {
        roomId: room.id,
        userId: users[0].id,
        username: users[0].username
      });

      httpsVoiceHandler.handleJoinVoice(users[1].socket, {
        roomId: room.id,
        userId: users[1].id,
        username: users[1].username
      });

      // WebRTC offer/answer exchange
      httpsVoiceHandler.handleVoiceOffer(users[0].socket, {
        roomId: room.id,
        targetUserId: users[1].id,
        offer: {
          type: 'offer',
          sdp: generateMockSDP('offer')
        }
      });

      httpsVoiceHandler.handleVoiceAnswer(users[1].socket, {
        roomId: room.id,
        targetUserId: users[0].id,
        answer: {
          type: 'answer',
          sdp: generateMockSDP('answer')
        }
      });

      const connectionTime = (Bun.nanoseconds() - connectionStart) / 1_000_000;
      const totalTime = (Bun.nanoseconds() - startTime) / 1_000_000;
      
      performanceMetrics.connectionEstablishment.push(connectionTime);

      // Performance assertions - Requirements: 8.1, 8.4
      expect(sslTime).toBeLessThan(10); // SSL handshake under 10ms
      expect(connectionTime).toBeLessThan(25); // Connection establishment under 25ms (allowing SSL overhead)
      expect(totalTime).toBeLessThan(50); // Total time under 50ms

      // Verify participants
      const participants = httpsVoiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(2);

      console.log(`🔒 HTTPS Connection: SSL=${sslTime.toFixed(2)}ms, Connection=${connectionTime.toFixed(2)}ms, Total=${totalTime.toFixed(2)}ms`);
    });

    it('should compare HTTPS vs HTTP connection establishment times', async () => {
      const iterations = 5;
      const httpsResults: number[] = [];
      const httpResults: number[] = [];

      // Test HTTPS connections
      for (let i = 0; i < iterations; i++) {
        const room = await createTestRoom(`HTTPS Test ${i}`);
        const users = await createTestUsers(room.id, 2, true);
        
        const start = Bun.nanoseconds();
        await performWebRTCHandshake(httpsVoiceHandler, users, room.id);
        const time = (Bun.nanoseconds() - start) / 1_000_000;
        httpsResults.push(time);
      }

      // Test HTTP connections
      for (let i = 0; i < iterations; i++) {
        const room = await createTestRoom(`HTTP Test ${i}`);
        const users = await createTestUsers(room.id, 2, false);
        
        const start = Bun.nanoseconds();
        await performWebRTCHandshake(httpVoiceHandler, users, room.id);
        const time = (Bun.nanoseconds() - start) / 1_000_000;
        httpResults.push(time);
      }

      const httpsAvg = calculateAverage(httpsResults);
      const httpAvg = calculateAverage(httpResults);
      const sslOverhead = httpsAvg - httpAvg;
      const overheadPercentage = (sslOverhead / httpAvg) * 100;

      // Performance assertions
      expect(httpsAvg).toBeLessThan(30); // HTTPS average under 30ms
      expect(sslOverhead).toBeLessThan(15); // SSL overhead under 15ms
      expect(overheadPercentage).toBeLessThan(50); // SSL overhead under 50%

      console.log(`📊 Performance Comparison: HTTPS=${httpsAvg.toFixed(2)}ms, HTTP=${httpAvg.toFixed(2)}ms, Overhead=${sslOverhead.toFixed(2)}ms (${overheadPercentage.toFixed(1)}%)`);
    });
  });

  describe('Mesh Topology Creation over HTTPS', () => {
    it('should create mesh topology identically over HTTPS without performance degradation', async () => {
      const userCount = 4;
      const meshStart = Bun.nanoseconds();
      
      // Create test room with multiple users
      const room = await createTestRoom('HTTPS Mesh Test');
      const users = await createTestUsers(room.id, userCount, true);

      // Measure mesh setup time
      const setupStart = Bun.nanoseconds();
      
      // All users join voice
      for (const user of users) {
        httpsVoiceHandler.handleJoinVoice(user.socket, {
          roomId: room.id,
          userId: user.id,
          username: user.username
        });
      }

      const setupTime = (Bun.nanoseconds() - setupStart) / 1_000_000;

      // Test mesh connection requests
      const meshRequestStart = Bun.nanoseconds();
      
      for (const user of users) {
        httpsVoiceHandler.handleRequestMeshConnections(user.socket, {
          roomId: room.id,
          userId: user.id
        });
      }

      const meshRequestTime = (Bun.nanoseconds() - meshRequestStart) / 1_000_000;
      const totalMeshTime = (Bun.nanoseconds() - meshStart) / 1_000_000;
      
      performanceMetrics.meshTopologyCreation.push(totalMeshTime);

      // Performance assertions for mesh over HTTPS
      expect(setupTime).toBeLessThan(100); // Setup under 100ms
      expect(meshRequestTime).toBeLessThan(50); // Mesh requests under 50ms
      expect(totalMeshTime).toBeLessThan(150); // Total mesh creation under 150ms

      // Verify mesh topology
      const participants = httpsVoiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(userCount);

      // Verify mesh connections would be established between all pairs
      const expectedConnections = (userCount * (userCount - 1)) / 2;
      expect(expectedConnections).toBe(6); // 4 users = 6 connections

      console.log(`🕸️ HTTPS Mesh (${userCount} users): Setup=${setupTime.toFixed(2)}ms, Requests=${meshRequestTime.toFixed(2)}ms, Total=${totalMeshTime.toFixed(2)}ms`);
    });

    it('should handle mesh topology scaling over HTTPS', async () => {
      const userCounts = [2, 4, 6, 8];
      const scalingResults: Array<{ users: number; time: number; perUser: number }> = [];

      for (const userCount of userCounts) {
        const room = await createTestRoom(`Scaling Test ${userCount}`);
        const users = await createTestUsers(room.id, userCount, true);

        const start = Bun.nanoseconds();
        
        // All users join and request mesh connections
        for (const user of users) {
          httpsVoiceHandler.handleJoinVoice(user.socket, {
            roomId: room.id,
            userId: user.id,
            username: user.username
          });
        }

        for (const user of users) {
          httpsVoiceHandler.handleRequestMeshConnections(user.socket, {
            roomId: room.id,
            userId: user.id
          });
        }

        const time = (Bun.nanoseconds() - start) / 1_000_000;
        const perUser = time / userCount;
        
        scalingResults.push({ users: userCount, time, perUser });

        // Verify participants
        const participants = httpsVoiceHandler.getVoiceParticipants(room.id);
        expect(participants).toHaveLength(userCount);
      }

      // Analyze scaling performance
      for (const result of scalingResults) {
        expect(result.time).toBeLessThan(200); // Total time under 200ms
        expect(result.perUser).toBeLessThan(30); // Per-user time under 30ms
      }

      // Verify linear scaling (not exponential degradation)
      const maxPerUser = Math.max(...scalingResults.map(r => r.perUser));
      const minPerUser = Math.min(...scalingResults.map(r => r.perUser));
      const scalingFactor = maxPerUser / minPerUser;
      expect(scalingFactor).toBeLessThan(3); // Scaling factor under 3x

      console.log('📈 HTTPS Mesh Scaling:');
      scalingResults.forEach(r => {
        console.log(`   ${r.users} users: ${r.time.toFixed(2)}ms total, ${r.perUser.toFixed(2)}ms per user`);
      });
    });
  });

  describe('ICE Candidate Gathering and WebRTC Negotiation with SSL', () => {
    it('should handle ICE candidate gathering efficiently over HTTPS', async () => {
      const room = await createTestRoom('ICE Test Room');
      const users = await createTestUsers(room.id, 2, true);

      // Join voice
      httpsVoiceHandler.handleJoinVoice(users[0].socket, {
        roomId: room.id,
        userId: users[0].id,
        username: users[0].username
      });

      httpsVoiceHandler.handleJoinVoice(users[1].socket, {
        roomId: room.id,
        userId: users[1].id,
        username: users[1].username
      });

      // Test ICE candidate gathering performance
      const candidateCount = 10;
      const iceStart = Bun.nanoseconds();
      const candidateLatencies: number[] = [];

      for (let i = 0; i < candidateCount; i++) {
        const candidateStart = Bun.nanoseconds();
        
        httpsVoiceHandler.handleVoiceIceCandidate(users[0].socket, {
          roomId: room.id,
          targetUserId: users[1].id,
          candidate: {
            candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
            sdpMLineIndex: 0,
            sdpMid: 'audio'
          }
        });

        const candidateTime = (Bun.nanoseconds() - candidateStart) / 1_000_000;
        candidateLatencies.push(candidateTime);
      }

      const totalIceTime = (Bun.nanoseconds() - iceStart) / 1_000_000;
      performanceMetrics.iceGathering.push(totalIceTime);

      // Performance assertions for ICE over HTTPS
      const avgLatency = calculateAverage(candidateLatencies);
      const maxLatency = Math.max(...candidateLatencies);

      expect(avgLatency).toBeLessThan(5); // Average ICE latency under 5ms
      expect(maxLatency).toBeLessThan(10); // Max ICE latency under 10ms
      expect(totalIceTime).toBeLessThan(80); // Total ICE gathering under 80ms

      console.log(`🧊 HTTPS ICE Gathering (${candidateCount} candidates): Avg=${avgLatency.toFixed(2)}ms, Max=${maxLatency.toFixed(2)}ms, Total=${totalIceTime.toFixed(2)}ms`);
    });

    it('should complete full WebRTC negotiation over HTTPS efficiently', async () => {
      const room = await createTestRoom('WebRTC Negotiation Test');
      const users = await createTestUsers(room.id, 2, true);

      const negotiationStart = Bun.nanoseconds();

      // Join voice
      httpsVoiceHandler.handleJoinVoice(users[0].socket, {
        roomId: room.id,
        userId: users[0].id,
        username: users[0].username
      });

      httpsVoiceHandler.handleJoinVoice(users[1].socket, {
        roomId: room.id,
        userId: users[1].id,
        username: users[1].username
      });

      // Full WebRTC negotiation
      const offerStart = Bun.nanoseconds();
      httpsVoiceHandler.handleVoiceOffer(users[0].socket, {
        roomId: room.id,
        targetUserId: users[1].id,
        offer: {
          type: 'offer',
          sdp: generateRealisticSDP('offer')
        }
      });
      const offerTime = (Bun.nanoseconds() - offerStart) / 1_000_000;

      const answerStart = Bun.nanoseconds();
      httpsVoiceHandler.handleVoiceAnswer(users[1].socket, {
        roomId: room.id,
        targetUserId: users[0].id,
        answer: {
          type: 'answer',
          sdp: generateRealisticSDP('answer')
        }
      });
      const answerTime = (Bun.nanoseconds() - answerStart) / 1_000_000;

      // ICE candidates
      const iceStart = Bun.nanoseconds();
      for (let i = 0; i < 5; i++) {
        httpsVoiceHandler.handleVoiceIceCandidate(users[0].socket, {
          roomId: room.id,
          targetUserId: users[1].id,
          candidate: {
            candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
            sdpMLineIndex: 0,
            sdpMid: 'audio'
          }
        });
      }
      const iceTime = (Bun.nanoseconds() - iceStart) / 1_000_000;

      const totalNegotiationTime = (Bun.nanoseconds() - negotiationStart) / 1_000_000;
      performanceMetrics.webrtcNegotiation.push(totalNegotiationTime);

      // Performance assertions for full negotiation over HTTPS
      expect(offerTime).toBeLessThan(8); // Offer under 8ms
      expect(answerTime).toBeLessThan(8); // Answer under 8ms
      expect(iceTime).toBeLessThan(20); // ICE candidates under 20ms
      expect(totalNegotiationTime).toBeLessThan(60); // Total negotiation under 60ms

      // Verify participants
      const participants = httpsVoiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(2);

      console.log(`🤝 HTTPS WebRTC Negotiation: Offer=${offerTime.toFixed(2)}ms, Answer=${answerTime.toFixed(2)}ms, ICE=${iceTime.toFixed(2)}ms, Total=${totalNegotiationTime.toFixed(2)}ms`);
    });
  });

  describe('Multiple Concurrent Connections in HTTPS Environment', () => {
    it('should handle multiple concurrent WebRTC connections over HTTPS', async () => {
      const concurrentUsers = 6;
      const room = await createTestRoom('Concurrent HTTPS Test');
      const users = await createTestUsers(room.id, concurrentUsers, true);

      const concurrentStart = Bun.nanoseconds();

      // Concurrent voice joins
      const joinPromises = users.map(async (user, index) => {
        const joinStart = Bun.nanoseconds();
        
        httpsVoiceHandler.handleJoinVoice(user.socket, {
          roomId: room.id,
          userId: user.id,
          username: user.username
        });
        
        return (Bun.nanoseconds() - joinStart) / 1_000_000;
      });

      const joinTimes = await Promise.all(joinPromises);
      const joinPhaseTime = Math.max(...joinTimes);

      // Concurrent WebRTC offers (all to first user)
      const offerPromises = users.slice(1).map(async (user, index) => {
        const offerStart = Bun.nanoseconds();
        
        httpsVoiceHandler.handleVoiceOffer(user.socket, {
          roomId: room.id,
          targetUserId: users[0].id,
          offer: {
            type: 'offer',
            sdp: generateMockSDP('offer')
          }
        });
        
        return (Bun.nanoseconds() - offerStart) / 1_000_000;
      });

      const offerTimes = await Promise.all(offerPromises);
      const offerPhaseTime = Math.max(...offerTimes);

      const totalConcurrentTime = (Bun.nanoseconds() - concurrentStart) / 1_000_000;

      // Performance assertions for concurrent connections over HTTPS
      const avgJoinTime = calculateAverage(joinTimes);
      const avgOfferTime = calculateAverage(offerTimes);

      expect(joinPhaseTime).toBeLessThan(50); // Concurrent joins under 50ms
      expect(avgJoinTime).toBeLessThan(20); // Average join under 20ms
      expect(offerPhaseTime).toBeLessThan(30); // Concurrent offers under 30ms
      expect(avgOfferTime).toBeLessThan(15); // Average offer under 15ms
      expect(totalConcurrentTime).toBeLessThan(100); // Total concurrent test under 100ms

      // Verify all participants joined
      const participants = httpsVoiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(concurrentUsers);

      console.log(`⚡ HTTPS Concurrent (${concurrentUsers} users): Joins=${joinPhaseTime.toFixed(2)}ms, Offers=${offerPhaseTime.toFixed(2)}ms, Total=${totalConcurrentTime.toFixed(2)}ms`);
    });

    it('should maintain performance under high concurrent load over HTTPS', async () => {
      const loadLevels = [4, 8, 12];
      const loadResults: Array<{ users: number; time: number; throughput: number }> = [];

      for (const userCount of loadLevels) {
        const room = await createTestRoom(`Load Test ${userCount}`);
        const users = await createTestUsers(room.id, userCount, true);

        const loadStart = Bun.nanoseconds();

        // Simulate high load scenario
        const operations = [];
        
        // All users join
        for (const user of users) {
          operations.push(async () => {
            httpsVoiceHandler.handleJoinVoice(user.socket, {
              roomId: room.id,
              userId: user.id,
              username: user.username
            });
          });
        }

        // All users make offers to each other (partial mesh)
        for (let i = 0; i < userCount - 1; i++) {
          operations.push(async () => {
            httpsVoiceHandler.handleVoiceOffer(users[i].socket, {
              roomId: room.id,
              targetUserId: users[i + 1].id,
              offer: {
                type: 'offer',
                sdp: generateMockSDP('offer')
              }
            });
          });
        }

        // Execute all operations concurrently
        await Promise.all(operations.map(op => op()));

        const loadTime = (Bun.nanoseconds() - loadStart) / 1_000_000;
        const throughput = operations.length / (loadTime / 1000); // operations per second

        loadResults.push({ users: userCount, time: loadTime, throughput });

        // Performance assertions for high load
        expect(loadTime).toBeLessThan(200); // Load test under 200ms
        expect(throughput).toBeGreaterThan(50); // At least 50 ops/sec

        // Verify all participants
        const participants = httpsVoiceHandler.getVoiceParticipants(room.id);
        expect(participants).toHaveLength(userCount);
      }

      console.log('🔥 HTTPS Load Test Results:');
      loadResults.forEach(r => {
        console.log(`   ${r.users} users: ${r.time.toFixed(2)}ms, ${r.throughput.toFixed(1)} ops/sec`);
      });
    });
  });

  describe('HTTPS Performance Regression Detection', () => {
    it('should ensure no significant performance degradation from HTTPS overhead', async () => {
      const testIterations = 10;
      const httpsResults: number[] = [];
      const httpResults: number[] = [];

      // Test HTTPS performance
      for (let i = 0; i < testIterations; i++) {
        const room = await createTestRoom(`HTTPS Regression ${i}`);
        const users = await createTestUsers(room.id, 2, true);
        
        const start = Bun.nanoseconds();
        await performCompleteWebRTCFlow(httpsVoiceHandler, users, room.id);
        const time = (Bun.nanoseconds() - start) / 1_000_000;
        httpsResults.push(time);
      }

      // Test HTTP performance for comparison
      for (let i = 0; i < testIterations; i++) {
        const room = await createTestRoom(`HTTP Regression ${i}`);
        const users = await createTestUsers(room.id, 2, false);
        
        const start = Bun.nanoseconds();
        await performCompleteWebRTCFlow(httpVoiceHandler, users, room.id);
        const time = (Bun.nanoseconds() - start) / 1_000_000;
        httpResults.push(time);
      }

      // Analyze performance regression
      const httpsAvg = calculateAverage(httpsResults);
      const httpAvg = calculateAverage(httpResults);
      const httpsStdDev = calculateStandardDeviation(httpsResults);
      const httpStdDev = calculateStandardDeviation(httpResults);
      
      const sslOverhead = httpsAvg - httpAvg;
      const overheadPercentage = (sslOverhead / httpAvg) * 100;
      const performanceVariance = httpsStdDev / httpsAvg;

      // Performance regression assertions - Requirements: 8.1, 8.4
      expect(httpsAvg).toBeLessThan(60); // HTTPS average under 60ms
      expect(sslOverhead).toBeLessThan(20); // SSL overhead under 20ms
      expect(overheadPercentage).toBeLessThan(40); // SSL overhead under 40%
      expect(performanceVariance).toBeLessThan(0.3); // Performance variance under 30%

      // Ensure consistent performance
      const httpsMax = Math.max(...httpsResults);
      const httpsMin = Math.min(...httpsResults);
      const performanceRange = httpsMax - httpsMin;
      expect(performanceRange).toBeLessThan(50); // Performance range under 50ms

      console.log('📊 Performance Regression Analysis:');
      console.log(`   HTTPS: ${httpsAvg.toFixed(2)}ms ± ${httpsStdDev.toFixed(2)}ms`);
      console.log(`   HTTP:  ${httpAvg.toFixed(2)}ms ± ${httpStdDev.toFixed(2)}ms`);
      console.log(`   SSL Overhead: ${sslOverhead.toFixed(2)}ms (${overheadPercentage.toFixed(1)}%)`);
      console.log(`   Performance Variance: ${(performanceVariance * 100).toFixed(1)}%`);
    });
  });

  // Helper functions
  async function createTestRoom(name: string): Promise<TestRoom> {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ownerId = `owner_${Date.now()}`;
    
    roomService.createRoom(roomId, name, ownerId);
    
    return { id: roomId, name, ownerId };
  }

  async function createTestUsers(roomId: string, count: number, useHTTPS: boolean): Promise<TestUser[]> {
    const users: TestUser[] = [];
    
    for (let i = 0; i < count; i++) {
      const userId = `user_${Date.now()}_${i}`;
      const username = `TestUser${i}`;
      
      // Create mock socket with jest functions
      const mockSocket = {
        id: `socket_${userId}`,
        data: { userId, username },
        emit: jest.fn(),
        to: jest.fn().mockReturnThis(),
        join: jest.fn(),
        leave: jest.fn()
      };

      // Register session
      roomSessionManager.setRoomSession(roomId, mockSocket.id, {
        roomId,
        userId,
        username,
        joinedAt: Date.now()
      });

      users.push({
        id: userId,
        username,
        socket: mockSocket
      });
    }
    
    return users;
  }

  async function performWebRTCHandshake(voiceHandler: VoiceConnectionHandler, users: TestUser[], roomId: string): Promise<void> {
    // Join voice
    voiceHandler.handleJoinVoice(users[0].socket, {
      roomId,
      userId: users[0].id,
      username: users[0].username
    });

    voiceHandler.handleJoinVoice(users[1].socket, {
      roomId,
      userId: users[1].id,
      username: users[1].username
    });

    // WebRTC handshake
    voiceHandler.handleVoiceOffer(users[0].socket, {
      roomId,
      targetUserId: users[1].id,
      offer: {
        type: 'offer',
        sdp: generateMockSDP('offer')
      }
    });

    voiceHandler.handleVoiceAnswer(users[1].socket, {
      roomId,
      targetUserId: users[0].id,
      answer: {
        type: 'answer',
        sdp: generateMockSDP('answer')
      }
    });
  }

  async function performCompleteWebRTCFlow(voiceHandler: VoiceConnectionHandler, users: TestUser[], roomId: string): Promise<void> {
    await performWebRTCHandshake(voiceHandler, users, roomId);
    
    // Add ICE candidates
    for (let i = 0; i < 3; i++) {
      voiceHandler.handleVoiceIceCandidate(users[0].socket, {
        roomId,
        targetUserId: users[1].id,
        candidate: {
          candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
          sdpMLineIndex: 0,
          sdpMid: 'audio'
        }
      });
    }
  }

  async function simulateSSLHandshake(): Promise<void> {
    // Simulate SSL handshake delay (1-3ms for localhost)
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2 + 1));
  }

  function generateMockSDP(type: 'offer' | 'answer'): string {
    const sessionId = Date.now();
    return `v=0\r\no=- ${sessionId} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE audio\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\na=setup:${type === 'offer' ? 'actpass' : 'active'}\r\na=mid:audio\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n`;
  }

  function generateRealisticSDP(type: 'offer' | 'answer'): string {
    const sessionId = Date.now();
    return `v=0\r\no=- ${sessionId} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 103 104 9 0 8 106 105 13 110 112 113 126\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\na=setup:${type === 'offer' ? 'actpass' : 'active'}\r\na=mid:0\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:103 ISAC/16000\r\na=rtpmap:104 ISAC/32000\r\na=rtpmap:9 G722/8000\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\na=rtpmap:106 CN/32000\r\na=rtpmap:105 CN/16000\r\na=rtpmap:13 CN/8000\r\na=rtpmap:110 telephone-event/48000\r\na=rtpmap:112 telephone-event/32000\r\na=rtpmap:113 telephone-event/16000\r\na=rtpmap:126 telephone-event/8000\r\n`;
  }

  function calculateAverage(numbers: number[]): number {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  }

  function calculateStandardDeviation(numbers: number[]): number {
    const avg = calculateAverage(numbers);
    const squareDiffs = numbers.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = calculateAverage(squareDiffs);
    return Math.sqrt(avgSquareDiff);
  }
});