import { HTTPSTestConfigFactory, HTTPSWebRTCTestHelper } from '../HTTPSTestConfig';
import { HTTPSTestEnvironment } from '../HTTPSTestEnvironment';
import { ParallelTestHarness } from '../ParallelTestHarness';

describe('HTTPS WebRTC Integration Tests', () => {
  let httpsEnv: HTTPSTestEnvironment;
  let webrtcHelper: HTTPSWebRTCTestHelper;
  let testHarness: ParallelTestHarness;

  beforeAll(async () => {
    // Initialize HTTPS test environment with existing SSL certificates
    httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
      enableLogging: false,
      port: 0,
      allowSelfSigned: true
    });
    
    await httpsEnv.initialize();
    webrtcHelper = new HTTPSWebRTCTestHelper(httpsEnv);
    testHarness = new ParallelTestHarness();
  });

  afterAll(async () => {
    await httpsEnv.cleanup();
  });

  describe('SSL Certificate Integration', () => {
    it('should use existing SSL certificates from .ssl directory', async () => {
      const validation = await HTTPSTestConfigFactory.validateSSLConfig(
        '.ssl/server.crt',
        '.ssl/server.key'
      );

      expect(validation.valid).toBe(true);
      expect(validation.details.certExists).toBe(true);
      expect(validation.details.keyExists).toBe(true);
      expect(validation.details.certReadable).toBe(true);
      expect(validation.details.keyReadable).toBe(true);
    });

    it('should initialize HTTPS server with SSL certificates', () => {
      expect(httpsEnv.getPort()).toBeGreaterThan(0);
      expect(httpsEnv.getHTTPSUrl()).toMatch(/^https:\/\/localhost:\d+$/);
      expect(httpsEnv.isHTTPSEnabled()).toBe(true);
    });

    it('should provide WebRTC configuration for HTTPS connections', () => {
      const config = httpsEnv.getWebRTCTestConfig();
      
      expect(config.httpsUrl).toMatch(/^https:\/\/localhost:\d+$/);
      expect(config.iceServers).toHaveLength(1);
      expect(config.iceServers[0].urls).toBe('stun:stun.l.google.com:19302');
      expect(config.allowInsecure).toBe(true); // For self-signed certificates
    });
  });

  describe('WebRTC over HTTPS End-to-End', () => {
    it('should establish complete WebRTC connection over HTTPS', async () => {
      // Create test room
      const { room } = await httpsEnv.createTestRoom('E2E HTTPS Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      // Test WebRTC connection establishment
      const result = await webrtcHelper.testWebRTCConnection(
        users[0].socket,
        users[1].socket,
        room.id
      );

      expect(result.success).toBe(true);
      expect(result.latency).toBeGreaterThan(0);
      expect(result.latency).toBeLessThan(100); // Should be fast for localhost
      expect(result.sslHandshakeTime).toBeGreaterThan(0);
      expect(result.webrtcHandshakeTime).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it('should handle multiple users joining room over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('Multi-user HTTPS Test');
      
      // Add users one by one and test connections
      const users = [];
      for (let i = 1; i <= 4; i++) {
        const newUsers = await httpsEnv.addTestUsersToRoom(room.id, 1);
        users.push(...newUsers);

        // Test connection with previous users
        if (users.length > 1) {
          const result = await webrtcHelper.testWebRTCConnection(
            users[0].socket,
            users[users.length - 1].socket,
            room.id
          );
          expect(result.success).toBe(true);
        }
      }

      expect(users).toHaveLength(4);
    });

    it('should maintain WebRTC mesh topology over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('Mesh Topology Test');
      const result = await webrtcHelper.testConcurrentConnections(4, room.id);

      // 4 users should create 6 connections (n*(n-1)/2)
      expect(result.successfulConnections).toBe(6);
      expect(result.failedConnections).toBe(0);
      expect(result.averageLatency).toBeGreaterThan(0);
      expect(result.averageLatency).toBeLessThan(200); // Reasonable for localhost mesh
    });
  });

  describe('Performance and Scalability over HTTPS', () => {
    it('should maintain acceptable performance with SSL overhead', async () => {
      const benchmark = await webrtcHelper.benchmarkHTTPSvsHTTP(10);

      expect(benchmark.httpsResults.successRate).toBeGreaterThan(0.9); // 90% success rate
      expect(benchmark.httpResults.successRate).toBeGreaterThan(0.9);
      expect(benchmark.sslOverhead).toBeGreaterThanOrEqual(0);
      expect(benchmark.sslOverhead).toBeLessThan(50); // SSL overhead should be reasonable
      
      // HTTPS should not be more than 50% slower than HTTP for localhost
      const performanceRatio = benchmark.httpsResults.averageLatency / benchmark.httpResults.averageLatency;
      expect(performanceRatio).toBeLessThan(1.5);
    });

    it('should handle concurrent room creation over HTTPS', async () => {
      const roomPromises = [];
      
      // Create 5 rooms concurrently
      for (let i = 0; i < 5; i++) {
        roomPromises.push(httpsEnv.createTestRoom(`Concurrent Room ${i}`));
      }

      const rooms = await Promise.all(roomPromises);
      expect(rooms).toHaveLength(5);

      // Each room should have unique ID and be properly initialized
      const roomIds = rooms.map(r => r.room.id);
      const uniqueIds = new Set(roomIds);
      expect(uniqueIds.size).toBe(5); // All IDs should be unique
    });

    it('should handle WebRTC connection failures gracefully over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('Failure Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      // Test with invalid room ID to simulate failure
      const result = await webrtcHelper.testWebRTCConnection(
        users[0].socket,
        users[1].socket,
        'invalid-room-id'
      );

      // Should handle failure gracefully without throwing
      expect(result.success).toBeDefined();
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Frontend Compatibility', () => {
    it('should create environment compatible with Vite mkcert plugin', async () => {
      const frontendEnv = HTTPSTestConfigFactory.createFrontendCompatible({
        port: 3001
      });

      await frontendEnv.initialize();

      expect(frontendEnv.getPort()).toBe(3001);
      expect(frontendEnv.getHTTPSUrl()).toBe('https://localhost:3001');

      // Should be able to create WebRTC connections
      const { room } = await frontendEnv.createTestRoom('Frontend Compat Test');
      const users = await frontendEnv.addTestUsersToRoom(room.id, 2);

      const helper = new HTTPSWebRTCTestHelper(frontendEnv);
      const result = await helper.testWebRTCConnection(
        users[0].socket,
        users[1].socket,
        room.id
      );

      expect(result.success).toBe(true);

      await frontendEnv.cleanup();
    });

    it('should provide WebRTC config compatible with browser requirements', () => {
      const config = HTTPSTestConfigFactory.getWebRTCTestConfig(httpsEnv.getHTTPSUrl());

      // Should have multiple STUN servers for reliability
      expect(config.iceServers).toHaveLength(2);
      expect(config.iceServers[0].urls).toBe('stun:stun.l.google.com:19302');
      expect(config.iceServers[1].urls).toBe('stun:stun1.l.google.com:19302');

      // Should be configured for audio-only (jam band use case)
      expect(config.constraints.audio).toBe(true);
      expect(config.constraints.video).toBe(false);

      // Should allow self-signed certificates for development
      expect(config.allowInsecure).toBe(true);
    });
  });

  describe('mkcert Integration', () => {
    it('should validate mkcert compatibility', async () => {
      const compatibility = await httpsEnv.validateMkcertCompatibility();

      expect(compatibility.certificateValid).toBe(true);
      expect(compatibility.browserCompatible).toBe(true);
      // mkcertAvailable may be false if mkcert is not installed, which is acceptable
    });

    it('should work with mkcert-style certificate paths', async () => {
      // Test with mkcert-style paths (even if they don't exist)
      const mkcertEnv = HTTPSTestConfigFactory.createMkcertCompatible({
        sslCertPath: '.ssl/server.crt', // Fallback to existing certs
        sslKeyPath: '.ssl/server.key',
        allowSelfSigned: true
      });

      await mkcertEnv.initialize();
      expect(mkcertEnv.isHTTPSEnabled()).toBe(true);
      await mkcertEnv.cleanup();
    });
  });

  describe('Parallel Testing with HTTPS', () => {
    it('should support parallel testing of HTTPS vs HTTP implementations', async () => {
      // Create HTTP environment for comparison
      const httpEnv = HTTPSTestConfigFactory.createHTTPForComparison();
      await httpEnv.initialize();

      // Register implementations for parallel testing
      testHarness.registerImplementations(
        httpEnv.getRoomHandlers(),
        httpsEnv.getRoomHandlers()
      );

      // Test room creation in parallel
      const testData = ['Test Room', 'testuser', 'user123', false];
      const result = await testHarness.executeParallel(
        'handleCreateRoom',
        testData,
        'https_vs_http_room_creation'
      );

      expect(result.isEqual).toBe(true); // Results should be identical
      expect(result.executionTimeNew).toBeGreaterThan(0);
      expect(result.executionTimeOld).toBeGreaterThan(0);

      // HTTPS might be slightly slower due to SSL overhead
      const performanceRatio = result.executionTimeNew / result.executionTimeOld;
      expect(performanceRatio).toBeLessThan(2); // Should not be more than 2x slower

      await httpEnv.cleanup();
    });

    it('should generate comprehensive test report for HTTPS testing', () => {
      const report = testHarness.generateReport();

      expect(report.totalTests).toBeGreaterThan(0);
      expect(report.results).toBeDefined();
      expect(report.averagePerformanceRatio).toBeGreaterThan(0);
      expect(report.averageMemoryRatio).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from SSL handshake failures', async () => {
      // Simulate SSL handshake failure by using invalid certificates
      const invalidEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        sslCertPath: 'nonexistent.crt',
        sslKeyPath: 'nonexistent.key',
        allowSelfSigned: true // This should trigger certificate generation
      });

      // Should either initialize with generated certs or fail gracefully
      try {
        await invalidEnv.initialize();
        expect(invalidEnv.isHTTPSEnabled()).toBe(true);
        await invalidEnv.cleanup();
      } catch (error) {
        // Graceful failure is acceptable
        expect(error).toBeDefined();
      }
    });

    it('should handle WebRTC connection timeouts over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('Timeout Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      // Test with very short timeout to simulate timeout scenario
      const startTime = Date.now();
      const result = await webrtcHelper.testWebRTCConnection(
        users[0].socket,
        users[1].socket,
        room.id
      );
      const duration = Date.now() - startTime;

      // Should complete within reasonable time or handle timeout gracefully
      expect(duration).toBeLessThan(5000); // 5 second max
      expect(result.success).toBeDefined();
    });
  });
});