import { HTTPSTestConfigFactory, HTTPSWebRTCTestHelper } from '../HTTPSTestConfig';
import { HTTPSTestEnvironment } from '../HTTPSTestEnvironment';
import { TestEnvironment } from '../TestEnvironment';

// Helper function to safely access array elements
function safeArrayAccess<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (!item) {
    throw new Error(`Array item at index ${index} is undefined`);
  }
  return item;
}

describe('HTTPS WebRTC Testing', () => {
  let httpsEnv: HTTPSTestEnvironment;
  let httpEnv: TestEnvironment;
  let webrtcHelper: HTTPSWebRTCTestHelper;

  beforeAll(async () => {
    // Initialize HTTPS test environment
    httpsEnv = HTTPSTestConfigFactory.createWithExistingCerts({
      enableLogging: false,
      port: 0
    });
    await httpsEnv.initialize();

    // Initialize HTTP test environment for comparison
    httpEnv = HTTPSTestConfigFactory.createHTTPForComparison({
      enableLogging: false,
      port: 0
    });
    await httpEnv.initialize();

    webrtcHelper = new HTTPSWebRTCTestHelper(httpsEnv);
  });

  afterAll(async () => {
    await httpsEnv.cleanup();
    await httpEnv.cleanup();
  });

  describe('SSL Certificate Configuration', () => {
    it('should validate existing SSL certificates', async () => {
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

    it('should handle missing SSL certificates gracefully', async () => {
      const validation = await HTTPSTestConfigFactory.validateSSLConfig(
        'nonexistent.crt',
        'nonexistent.key'
      );

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();
      expect(validation.details.certExists).toBe(false);
      expect(validation.details.keyExists).toBe(false);
    });
  });

  describe('HTTPS Test Environment', () => {
    it('should initialize HTTPS server with SSL certificates', async () => {
      expect(httpsEnv.isHTTPSEnabled()).toBe(true);
      expect(httpsEnv.getPort()).toBeGreaterThan(0);
      expect(httpsEnv.getHTTPSUrl()).toMatch(/^https:\/\/localhost:\d+$/);
    });

    it('should validate mkcert compatibility', async () => {
      const compatibility = await httpsEnv.validateMkcertCompatibility();
      
      expect(compatibility.certificateValid).toBe(true);
      expect(compatibility.browserCompatible).toBe(true);
      // mkcertAvailable may be false if mkcert is not installed, which is OK
    });

    it('should provide WebRTC test configuration', () => {
      const config = httpsEnv.getWebRTCTestConfig();
      
      expect(config.httpsUrl).toMatch(/^https:\/\/localhost:\d+$/);
      expect(config.iceServers).toHaveLength(1);
      expect(config.allowInsecure).toBe(true);
    });
  });

  describe('WebRTC over HTTPS', () => {
    it('should establish WebRTC connection over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('HTTPS WebRTC Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      const result = await webrtcHelper.testWebRTCConnection(
        safeArrayAccess(users, 0).socket,
        safeArrayAccess(users, 1).socket,
        room.id
      );

      expect(result.success).toBe(true);
      expect(result.latency).toBeGreaterThan(0);
      expect(result.sslHandshakeTime).toBeGreaterThan(0);
      expect(result.webrtcHandshakeTime).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it('should handle multiple concurrent HTTPS WebRTC connections', async () => {
      const { room } = await httpsEnv.createTestRoom('Concurrent HTTPS Test');
      
      const result = await webrtcHelper.testConcurrentConnections(4, room.id);

      expect(result.successfulConnections).toBeGreaterThan(0);
      expect(result.failedConnections).toBe(0);
      expect(result.averageLatency).toBeGreaterThan(0);
      expect(result.results).toHaveLength(6); // 4 users = 6 connections (4*3/2)
    });

    it('should maintain acceptable latency over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('Latency Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      const result = await webrtcHelper.testWebRTCConnection(
        safeArrayAccess(users, 0).socket,
        safeArrayAccess(users, 1).socket,
        room.id
      );

      expect(result.success).toBe(true);
      expect(result.latency).toBeLessThan(100); // Should be under 100ms for localhost
      expect(result.sslHandshakeTime).toBeLessThan(20); // SSL handshake should be fast
    });
  });

  describe('HTTPS vs HTTP Performance Comparison', () => {
    it('should benchmark HTTPS vs HTTP WebRTC performance', async () => {
      const benchmark = await webrtcHelper.benchmarkHTTPSvsHTTP(5);

      expect(benchmark.httpsResults.successRate).toBeGreaterThan(0.8); // 80% success rate
      expect(benchmark.httpResults.successRate).toBeGreaterThan(0.8);
      expect(benchmark.sslOverhead).toBeGreaterThanOrEqual(0); // HTTPS should have some overhead
      expect(benchmark.sslOverhead).toBeLessThan(50); // But not too much for localhost
      expect(benchmark.recommendation).toBeDefined();
    });

    it('should compare HTTPS and HTTP connection establishment', async () => {
      // Test HTTPS connection
      const { room: httpsRoom } = await httpsEnv.createTestRoom('HTTPS Comparison');
      const httpsUsers = await httpsEnv.addTestUsersToRoom(httpsRoom.id, 2);
      
      const httpsStart = Date.now();
      const httpsResult = await httpsEnv.simulateHTTPSWebRTCConnection(
        safeArrayAccess(httpsUsers, 0).socket,
        safeArrayAccess(httpsUsers, 1).socket,
        httpsRoom.id
      );
      const httpsTime = Date.now() - httpsStart;

      // Test HTTP connection
      const { room: httpRoom } = await httpEnv.createTestRoom('HTTP Comparison');
      const httpUsers = await httpEnv.addTestUsersToRoom(httpRoom.id, 2);
      
      const httpStart = Date.now();
      await httpEnv.simulateWebRTCConnection(
        safeArrayAccess(httpUsers, 0).socket,
        safeArrayAccess(httpUsers, 1).socket,
        httpRoom.id
      );
      const httpTime = Date.now() - httpStart;

      expect(httpsResult.success).toBe(true);
      expect(httpsTime).toBeGreaterThan(httpTime); // HTTPS should have some overhead
      expect(httpsTime - httpTime).toBeLessThan(20); // But not too much
    });
  });

  describe('Frontend Compatibility', () => {
    it('should create frontend-compatible HTTPS environment', async () => {
      const frontendEnv = HTTPSTestConfigFactory.createFrontendCompatible({
        port: 3001
      });
      
      await frontendEnv.initialize();

      expect(frontendEnv.getPort()).toBe(3001);
      expect(frontendEnv.getHTTPSUrl()).toBe('https://localhost:3001');

      await frontendEnv.cleanup();
    });

    it('should provide WebRTC config compatible with frontend', () => {
      const httpsUrl = httpsEnv.getHTTPSUrl();
      const config = HTTPSTestConfigFactory.getWebRTCTestConfig(httpsUrl);

      expect(config.httpsUrl).toBe(httpsUrl);
      expect(config.iceServers).toHaveLength(2); // Multiple STUN servers
      expect(config.allowInsecure).toBe(true); // For self-signed certs
      expect(config.constraints.audio).toBe(true);
      expect(config.constraints.video).toBe(false); // Audio-only for jam band
    });
  });

  describe('Error Handling', () => {
    it('should handle SSL certificate errors gracefully', async () => {
      const invalidEnv = HTTPSTestConfigFactory.createWithExistingCerts({
        sslCertPath: 'invalid.crt',
        sslKeyPath: 'invalid.key',
        allowSelfSigned: false
      });

      await expect(invalidEnv.initialize()).rejects.toThrow();
    });

    it('should handle WebRTC connection failures over HTTPS', async () => {
      const { room } = await httpsEnv.createTestRoom('Error Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      // Simulate connection failure by using invalid room ID
      const result = await webrtcHelper.testWebRTCConnection(
        safeArrayAccess(users, 0).socket,
        safeArrayAccess(users, 1).socket,
        'invalid-room-id'
      );

      // The test should handle the error gracefully
      expect(result.success).toBeDefined();
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Monitoring', () => {
    it('should monitor SSL handshake performance', async () => {
      const { room } = await httpsEnv.createTestRoom('Performance Test');
      const users = await httpsEnv.addTestUsersToRoom(room.id, 2);

      const result = await webrtcHelper.testWebRTCConnection(
        safeArrayAccess(users, 0).socket,
        safeArrayAccess(users, 1).socket,
        room.id
      );

      expect(result.sslHandshakeTime).toBeGreaterThan(0);
      expect(result.sslHandshakeTime).toBeLessThan(10); // Should be fast for localhost
      expect(result.webrtcHandshakeTime).toBeGreaterThan(0);
    });

    it('should track performance regression', async () => {
      const performanceResults = await httpsEnv.compareHTTPSPerformance(3);

      expect(performanceResults.httpsLatency).toHaveLength(3);
      expect(performanceResults.averageHTTPSLatency).toBeGreaterThan(0);
      expect(performanceResults.sslOverhead).toBeGreaterThanOrEqual(0);
      expect(performanceResults.sslOverhead).toBeLessThan(30); // Reasonable overhead
    });
  });
});