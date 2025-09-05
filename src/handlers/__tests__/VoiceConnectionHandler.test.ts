import { VoiceConnectionHandler } from '../VoiceConnectionHandler';
import { RoomService } from '../../services/RoomService';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { HTTPSTestEnvironment } from '../../testing/HTTPSTestEnvironment';
import { PerformanceMonitor } from '../../testing/PerformanceMonitor';

/**
 * VoiceConnectionHandler Tests - WebRTC Performance over HTTPS
 * 
 * Tests WebRTC mesh functionality maintains low latency over SSL
 * Requirements: 8.1, 8.4
 */
describe('VoiceConnectionHandler - WebRTC HTTPS Performance Tests', () => {
  let voiceHandler: VoiceConnectionHandler;
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let io: Server;
  let httpsEnv: HTTPSTestEnvironment;
  let performanceMonitor: PerformanceMonitor;

  beforeEach(async () => {
    // Create HTTPS test environment
    httpsEnv = new HTTPSTestEnvironment({
      port: 0, // Use random port
      enableHTTPS: true,
      allowSelfSigned: true,
      enableLogging: false
    });

    await httpsEnv.initialize();

    // Get services from HTTPS environment
    roomService = httpsEnv.getRoomService();
    roomSessionManager = httpsEnv.getRoomSessionManager();
    io = httpsEnv.getIO();

    // Initialize VoiceConnectionHandler
    voiceHandler = new VoiceConnectionHandler(roomService, io, roomSessionManager);

    // Initialize performance monitor
    performanceMonitor = new PerformanceMonitor({
      enableMetrics: true,
      enableLogging: false
    });
  });

  afterEach(async () => {
    await httpsEnv.cleanup();
    performanceMonitor.cleanup();
  });

  describe('WebRTC Connection Establishment over HTTPS', () => {
    it('should establish WebRTC connections with low latency over SSL', async () => {
      const testMetric = performanceMonitor.startMetric('https_webrtc_connection');
      
      // Create test room and users through HTTPS environment
      const { room } = await httpsEnv.createTestRoom('HTTPS WebRTC Test Room');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);
      
      const user1 = users[0];
      const user2 = users[1];

      // Test voice join with performance measurement
      const joinMetric = performanceMonitor.startMetric('voice_join_https');
      
      voiceHandler.handleJoinVoice(user1.socket, {
        roomId: room.id,
        userId: user1.id,
        username: user1.username
      });

      voiceHandler.handleJoinVoice(user2.socket, {
        roomId: room.id,
        userId: user2.id,
        username: user2.username
      });

      const joinLatency = performanceMonitor.endMetric(joinMetric);

      // Test WebRTC offer/answer exchange with SSL overhead measurement
      const offerMetric = performanceMonitor.startMetric('webrtc_offer_https');
      
      voiceHandler.handleVoiceOffer(user1.socket, {
        roomId: room.id,
        targetUserId: user2.id,
        offer: {
          type: 'offer',
          sdp: 'mock-sdp-offer-https'
        }
      });

      const offerLatency = performanceMonitor.endMetric(offerMetric);

      const answerMetric = performanceMonitor.startMetric('webrtc_answer_https');
      
      voiceHandler.handleVoiceAnswer(user2.socket, {
        roomId: room.id,
        targetUserId: user1.id,
        answer: {
          type: 'answer',
          sdp: 'mock-sdp-answer-https'
        }
      });

      const answerLatency = performanceMonitor.endMetric(answerMetric);

      // Test ICE candidate exchange
      const iceMetric = performanceMonitor.startMetric('ice_candidate_https');
      
      voiceHandler.handleVoiceIceCandidate(user1.socket, {
        roomId: room.id,
        targetUserId: user2.id,
        candidate: {
          candidate: 'mock-ice-candidate-https',
          sdpMLineIndex: 0,
          sdpMid: 'audio'
        }
      });

      const iceLatency = performanceMonitor.endMetric(iceMetric);
      const totalTime = performanceMonitor.endMetric(testMetric);

      // Performance assertions - Requirements: 8.1, 8.4
      expect(joinLatency).toBeLessThan(15); // Join should be under 15ms (allowing for SSL overhead)
      expect(offerLatency).toBeLessThan(8); // Offer forwarding should be under 8ms (allowing for SSL overhead)
      expect(answerLatency).toBeLessThan(8); // Answer forwarding should be under 8ms (allowing for SSL overhead)
      expect(iceLatency).toBeLessThan(5); // ICE candidate forwarding should be under 5ms (allowing for SSL overhead)
      expect(totalTime).toBeLessThan(100); // Total WebRTC setup should be under 100ms (allowing for SSL overhead)

      // Verify voice participants were properly managed
      const participants = voiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(2);
      expect(participants.find(p => p.userId === user1.id)).toBeDefined();
      expect(participants.find(p => p.userId === user2.id)).toBeDefined();

      // Log performance metrics
      const metrics = performanceMonitor.getMetrics();
      console.log(`[HTTPS WebRTC Performance] Join: ${joinLatency.toFixed(2)}ms, Offer: ${offerLatency.toFixed(2)}ms, Answer: ${answerLatency.toFixed(2)}ms, ICE: ${iceLatency.toFixed(2)}ms, Total: ${totalTime.toFixed(2)}ms`);
      
      // Verify SSL certificates are working
      const sslValidation = await httpsEnv.validateMkcertCompatibility();
      expect(sslValidation.certificateValid).toBe(true);
    });

    it('should handle mesh topology creation over HTTPS without performance degradation', async () => {
      const userCount = 4; // Test with 4 users for mesh complexity
      const meshMetric = performanceMonitor.startMetric('mesh_topology_https');

      // Create test room with multiple users through HTTPS environment
      const { room } = await httpsEnv.createTestRoom('HTTPS Mesh Test Room');
      const users = await httpsEnv.addTestUsersToRoom(room.id, userCount);

      // Measure mesh connection setup time
      const meshSetupMetric = performanceMonitor.startMetric('mesh_setup_https');

      // Have all users join voice sequentially
      const joinLatencies: number[] = [];
      for (let i = 0; i < userCount; i++) {
        const joinMetric = performanceMonitor.startMetric(`mesh_join_${i}_https`);
        
        voiceHandler.handleJoinVoice(users[i].socket, {
          roomId: room.id,
          userId: users[i].id,
          username: users[i].username
        });

        const joinLatency = performanceMonitor.endMetric(joinMetric);
        joinLatencies.push(joinLatency);
        
        // Each join should remain fast even as mesh grows (allowing for SSL overhead)
        expect(joinLatency).toBeLessThan(20); // Should stay under 20ms per join with SSL
      }

      const meshSetupTime = performanceMonitor.endMetric(meshSetupMetric);

      // Test mesh connection requests
      const meshRequestMetric = performanceMonitor.startMetric('mesh_requests_https');
      
      for (let i = 0; i < userCount; i++) {
        voiceHandler.handleRequestMeshConnections(users[i].socket, {
          roomId: room.id,
          userId: users[i].id
        });
      }

      const meshRequestTime = performanceMonitor.endMetric(meshRequestMetric);
      const totalMeshTime = performanceMonitor.endMetric(meshMetric);

      // Performance assertions for mesh topology over HTTPS
      expect(meshSetupTime).toBeLessThan(150); // Total mesh setup under 150ms (allowing for SSL overhead)
      expect(meshRequestTime).toBeLessThan(80); // Mesh requests under 80ms (allowing for SSL overhead)
      expect(totalMeshTime).toBeLessThan(250); // Total mesh creation under 250ms
      
      // Verify all participants are in the mesh
      const participants = voiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(userCount);

      // Verify no significant performance degradation compared to HTTP
      const avgJoinLatency = joinLatencies.reduce((a, b) => a + b, 0) / joinLatencies.length;
      expect(avgJoinLatency).toBeLessThan(15); // Average join latency should be reasonable

      console.log(`[HTTPS Mesh Performance] Setup: ${meshSetupTime.toFixed(2)}ms, Requests: ${meshRequestTime.toFixed(2)}ms, Avg Join: ${avgJoinLatency.toFixed(2)}ms for ${userCount} users`);
    });

    it('should handle ICE candidate gathering with SSL certificates efficiently', async () => {
      const iceTestMetric = performanceMonitor.startMetric('ice_gathering_https');

      // Create test room and users through HTTPS environment
      const { room } = await httpsEnv.createTestRoom('HTTPS ICE Test Room');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);
      
      const user1 = users[0];
      const user2 = users[1];

      // Join voice
      voiceHandler.handleJoinVoice(user1.socket, {
        roomId: room.id,
        userId: user1.id,
        username: user1.username
      });

      voiceHandler.handleJoinVoice(user2.socket, {
        roomId: room.id,
        userId: user2.id,
        username: user2.username
      });

      // Test multiple ICE candidates with timing
      const candidateCount = 10;
      const candidateLatencies: number[] = [];

      for (let i = 0; i < candidateCount; i++) {
        const candidateMetric = performanceMonitor.startMetric(`ice_candidate_${i}_https`);
        
        voiceHandler.handleVoiceIceCandidate(user1.socket, {
          roomId: room.id,
          targetUserId: user2.id,
          candidate: {
            candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
            sdpMLineIndex: 0,
            sdpMid: 'audio'
          }
        });

        const candidateLatency = performanceMonitor.endMetric(candidateMetric);
        candidateLatencies.push(candidateLatency);
      }

      const totalIceTime = performanceMonitor.endMetric(iceTestMetric);

      // Performance assertions for ICE candidates over HTTPS
      const avgLatency = candidateLatencies.reduce((a, b) => a + b, 0) / candidateLatencies.length;
      const maxLatency = Math.max(...candidateLatencies);

      expect(avgLatency).toBeLessThan(5); // Average ICE candidate latency under 5ms (allowing for SSL overhead)
      expect(maxLatency).toBeLessThan(10); // Max ICE candidate latency under 10ms (allowing for SSL overhead)
      expect(totalIceTime).toBeLessThan(100); // Total ICE gathering under 100ms

      // Test ICE candidate gathering with WebRTC configuration
      const webrtcConfig = httpsEnv.getWebRTCTestConfig();
      expect(webrtcConfig.httpsUrl).toContain('https://');
      expect(webrtcConfig.iceServers).toBeDefined();
      expect(webrtcConfig.allowInsecure).toBe(true); // For test certificates

      console.log(`[HTTPS ICE Performance] Avg: ${avgLatency.toFixed(2)}ms, Max: ${maxLatency.toFixed(2)}ms, Total: ${totalIceTime.toFixed(2)}ms for ${candidateCount} candidates`);
    });

    it('should handle concurrent connections in HTTPS environment', async () => {
      const concurrentUsers = 6;
      const concurrentTestMetric = performanceMonitor.startMetric('concurrent_connections_https');

      // Create test room with multiple users through HTTPS environment
      const { room } = await httpsEnv.createTestRoom('HTTPS Concurrent Test Room');
      const users = await httpsEnv.addTestUsersToRoom(room.id, concurrentUsers);

      // Test concurrent voice joins
      const concurrentJoinMetric = performanceMonitor.startMetric('concurrent_joins_https');
      
      // Simulate concurrent joins (all at once)
      const joinPromises = users.map((user, index) => {
        return new Promise<number>((resolve) => {
          const joinMetric = performanceMonitor.startMetric(`concurrent_join_${index}_https`);
          
          voiceHandler.handleJoinVoice(user.socket, {
            roomId: room.id,
            userId: user.id,
            username: user.username
          });
          
          const joinTime = performanceMonitor.endMetric(joinMetric);
          resolve(joinTime);
        });
      });

      const joinTimes = await Promise.all(joinPromises);
      const concurrentJoinTime = performanceMonitor.endMetric(concurrentJoinMetric);

      // Test concurrent WebRTC offers
      const offerMetric = performanceMonitor.startMetric('concurrent_offers_https');
      
      const offerPromises = users.slice(1).map((user, index) => {
        return new Promise<number>((resolve) => {
          const singleOfferMetric = performanceMonitor.startMetric(`concurrent_offer_${index}_https`);
          
          voiceHandler.handleVoiceOffer(user.socket, {
            roomId: room.id,
            targetUserId: users[0].id, // All offer to first user
            offer: {
              type: 'offer',
              sdp: `mock-concurrent-offer-https-${index}`
            }
          });
          
          const offerTime = performanceMonitor.endMetric(singleOfferMetric);
          resolve(offerTime);
        });
      });

      const offerTimes = await Promise.all(offerPromises);
      const offerTotalTime = performanceMonitor.endMetric(offerMetric);
      const totalConcurrentTime = performanceMonitor.endMetric(concurrentTestMetric);

      // Performance assertions for concurrent operations over HTTPS
      const avgJoinTime = joinTimes.reduce((a, b) => a + b, 0) / joinTimes.length;
      const maxJoinTime = Math.max(...joinTimes);
      const avgOfferTime = offerTimes.reduce((a, b) => a + b, 0) / offerTimes.length;

      expect(concurrentJoinTime).toBeLessThan(300); // All concurrent joins under 300ms (allowing for SSL overhead)
      expect(avgJoinTime).toBeLessThan(25); // Average join time under 25ms (allowing for SSL overhead)
      expect(maxJoinTime).toBeLessThan(60); // Max join time under 60ms (allowing for SSL overhead)
      expect(avgOfferTime).toBeLessThan(15); // Average offer time under 15ms (allowing for SSL overhead)
      expect(offerTotalTime).toBeLessThan(150); // All offers under 150ms (allowing for SSL overhead)
      expect(totalConcurrentTime).toBeLessThan(500); // Total concurrent test under 500ms

      // Verify all participants joined successfully
      const participants = voiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(concurrentUsers);

      // Test that HTTPS doesn't significantly degrade performance
      const sslOverheadFactor = 1.5; // Allow up to 50% overhead for SSL
      expect(avgJoinTime).toBeLessThan(10 * sslOverheadFactor); // Base expectation with SSL overhead
      expect(avgOfferTime).toBeLessThan(5 * sslOverheadFactor); // Base expectation with SSL overhead

      console.log(`[HTTPS Concurrent Performance] ${concurrentUsers} users - Total: ${totalConcurrentTime.toFixed(2)}ms, Joins: ${concurrentJoinTime.toFixed(2)}ms, Avg Join: ${avgJoinTime.toFixed(2)}ms, Offers: ${offerTotalTime.toFixed(2)}ms`);
    });
  });

  describe('HTTPS SSL Certificate Integration', () => {
    it('should work with mkcert SSL certificates', async () => {
      const sslTestMetric = performanceMonitor.startMetric('ssl_certificate_test');

      // Verify HTTPS environment is properly configured
      expect(httpsEnv.isConfigured()).toBe(true);
      
      // Validate SSL certificate compatibility
      const sslValidation = await httpsEnv.validateMkcertCompatibility();
      expect(sslValidation.certificateValid).toBe(true);
      
      // Create test room and user through HTTPS environment
      const { room } = await httpsEnv.createTestRoom('SSL Test Room');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 1);
      const user = users[0];

      // Test voice operations with SSL
      const sslVoiceMetric = performanceMonitor.startMetric('ssl_voice_operation');
      
      voiceHandler.handleJoinVoice(user.socket, {
        roomId: room.id,
        userId: user.id,
        username: user.username
      });

      const sslVoiceTime = performanceMonitor.endMetric(sslVoiceMetric);
      const totalSslTime = performanceMonitor.endMetric(sslTestMetric);

      // Should work without SSL overhead affecting performance significantly
      expect(sslVoiceTime).toBeLessThan(15); // Allow for SSL overhead
      expect(totalSslTime).toBeLessThan(50); // Total SSL test time
      
      const participants = voiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(1);
      expect(participants[0].userId).toBe(user.id);

      // Test WebRTC configuration for HTTPS
      const webrtcConfig = httpsEnv.getWebRTCTestConfig();
      expect(webrtcConfig.httpsUrl).toMatch(/^https:\/\/localhost:\d+$/);
      expect(webrtcConfig.iceServers).toHaveLength(1);
      expect(webrtcConfig.allowInsecure).toBe(true);

      console.log(`[SSL Integration] Voice join with SSL: ${sslVoiceTime.toFixed(2)}ms, Total: ${totalSslTime.toFixed(2)}ms`);
    });

    it('should maintain WebRTC negotiation performance over HTTPS', async () => {
      const negotiationMetric = performanceMonitor.startMetric('webrtc_negotiation_https');

      // Create test room with two users
      const { room } = await httpsEnv.createTestRoom('WebRTC Negotiation Test Room');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);
      
      const user1 = users[0];
      const user2 = users[1];

      // Join voice
      voiceHandler.handleJoinVoice(user1.socket, {
        roomId: room.id,
        userId: user1.id,
        username: user1.username
      });

      voiceHandler.handleJoinVoice(user2.socket, {
        roomId: room.id,
        userId: user2.id,
        username: user2.username
      });

      // Simulate complete WebRTC negotiation over HTTPS
      const fullNegotiationMetric = performanceMonitor.startMetric('full_webrtc_negotiation_https');

      // Offer
      voiceHandler.handleVoiceOffer(user1.socket, {
        roomId: room.id,
        targetUserId: user2.id,
        offer: {
          type: 'offer',
          sdp: 'v=0\r\no=- 123456789 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE audio\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:testpassword\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\na=setup:actpass\r\na=mid:audio\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n'
        }
      });

      // Answer
      voiceHandler.handleVoiceAnswer(user2.socket, {
        roomId: room.id,
        targetUserId: user1.id,
        answer: {
          type: 'answer',
          sdp: 'v=0\r\no=- 987654321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE audio\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:test2\r\na=ice-pwd:testpassword2\r\na=fingerprint:sha-256 BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA\r\na=setup:active\r\na=mid:audio\r\na=sendrecv\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\n'
        }
      });

      // ICE candidates
      for (let i = 0; i < 3; i++) {
        voiceHandler.handleVoiceIceCandidate(user1.socket, {
          roomId: room.id,
          targetUserId: user2.id,
          candidate: {
            candidate: `candidate:${i} 1 UDP 2113667326 192.168.1.${100 + i} 54400 typ host`,
            sdpMLineIndex: 0,
            sdpMid: 'audio'
          }
        });

        voiceHandler.handleVoiceIceCandidate(user2.socket, {
          roomId: room.id,
          targetUserId: user1.id,
          candidate: {
            candidate: `candidate:${i + 10} 1 UDP 2113667326 192.168.1.${200 + i} 54401 typ host`,
            sdpMLineIndex: 0,
            sdpMid: 'audio'
          }
        });
      }

      const fullNegotiationTime = performanceMonitor.endMetric(fullNegotiationMetric);
      const totalNegotiationTime = performanceMonitor.endMetric(negotiationMetric);

      // Performance assertions for full WebRTC negotiation over HTTPS
      expect(fullNegotiationTime).toBeLessThan(50); // Full negotiation under 50ms
      expect(totalNegotiationTime).toBeLessThan(100); // Total test under 100ms

      // Verify participants are properly connected
      const participants = voiceHandler.getVoiceParticipants(room.id);
      expect(participants).toHaveLength(2);

      console.log(`[HTTPS WebRTC Negotiation] Full: ${fullNegotiationTime.toFixed(2)}ms, Total: ${totalNegotiationTime.toFixed(2)}ms`);
    });
  });

  describe('Performance Regression Detection', () => {
    it('should detect no significant performance regression with HTTPS', async () => {
      const regressionMetric = performanceMonitor.startMetric('regression_detection_https');

      // Run multiple test iterations to establish baseline
      const iterations = 5;
      const performanceResults: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const iterationMetric = performanceMonitor.startMetric(`regression_iteration_${i}_https`);
        
        const { room } = await httpsEnv.createTestRoom(`Regression Test Room ${i}`);
        const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

        // Test basic WebRTC operations
        voiceHandler.handleJoinVoice(users[0].socket, {
          roomId: room.id,
          userId: users[0].id,
          username: users[0].username
        });

        voiceHandler.handleJoinVoice(users[1].socket, {
          roomId: room.id,
          userId: users[1].id,
          username: users[1].username
        });

        voiceHandler.handleVoiceOffer(users[0].socket, {
          roomId: room.id,
          targetUserId: users[1].id,
          offer: {
            type: 'offer',
            sdp: `mock-regression-offer-${i}`
          }
        });

        const iterationTime = performanceMonitor.endMetric(iterationMetric);
        performanceResults.push(iterationTime);
      }

      const totalRegressionTime = performanceMonitor.endMetric(regressionMetric);

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

      console.log(`[HTTPS Regression Detection] Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms, Min: ${minTime.toFixed(2)}ms, Variance: ${variance.toFixed(2)}ms`);
    });
  });
});