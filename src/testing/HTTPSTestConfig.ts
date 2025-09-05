import { HTTPSTestEnvironment, HTTPSTestConfig } from './HTTPSTestEnvironment';
import { TestEnvironment } from './TestEnvironment';
import { join } from 'path';

/**
 * HTTPS Test Configuration Factory
 * Creates properly configured HTTPS test environments for WebRTC testing
 */
export class HTTPSTestConfigFactory {
  /**
   * Create HTTPS test environment with existing SSL certificates
   */
  static createWithExistingCerts(config: Partial<HTTPSTestConfig> = {}): HTTPSTestEnvironment {
    const defaultConfig: HTTPSTestConfig = {
      enableHTTPS: true,
      sslCertPath: join(process.cwd(), '.ssl', 'server.crt'),
      sslKeyPath: join(process.cwd(), '.ssl', 'server.key'),
      port: 0, // Random port for testing
      enableLogging: process.env.NODE_ENV === 'development',
      allowSelfSigned: true,
      ...config
    };

    return new HTTPSTestEnvironment(defaultConfig);
  }

  /**
   * Create HTTPS test environment with mkcert-compatible configuration
   */
  static createMkcertCompatible(config: Partial<HTTPSTestConfig> = {}): HTTPSTestEnvironment {
    const mkcertConfig: HTTPSTestConfig = {
      enableHTTPS: true,
      sslCertPath: join(process.cwd(), '.ssl', 'localhost.pem'),
      sslKeyPath: join(process.cwd(), '.ssl', 'localhost-key.pem'),
      port: 0,
      enableLogging: process.env.NODE_ENV === 'development',
      allowSelfSigned: true,
      ...config
    };

    return new HTTPSTestEnvironment(mkcertConfig);
  }

  /**
   * Create test environment that matches frontend mkcert plugin configuration
   */
  static createFrontendCompatible(config: Partial<HTTPSTestConfig> = {}): HTTPSTestEnvironment {
    // Frontend uses vite-plugin-mkcert which typically creates certificates in node_modules/.vite
    const frontendConfig: HTTPSTestConfig = {
      enableHTTPS: true,
      // Try to use the same certificates that vite-plugin-mkcert would use
      sslCertPath: config.sslCertPath || join(process.cwd(), '.ssl', 'server.crt'),
      sslKeyPath: config.sslKeyPath || join(process.cwd(), '.ssl', 'server.key'),
      port: config.port || 3001, // Different from frontend dev server (usually 3000)
      enableLogging: true,
      allowSelfSigned: true,
      ...config
    };

    return new HTTPSTestEnvironment(frontendConfig);
  }

  /**
   * Create HTTP test environment for comparison testing
   */
  static createHTTPForComparison(config: Partial<HTTPSTestConfig> = {}): TestEnvironment {
    return new TestEnvironment({
      enableHTTPS: false,
      port: 0,
      enableLogging: process.env.NODE_ENV === 'development',
      ...config
    });
  }

  /**
   * Validate SSL certificate configuration
   */
  static async validateSSLConfig(certPath: string, keyPath: string): Promise<{
    valid: boolean;
    error?: string;
    details: {
      certExists: boolean;
      keyExists: boolean;
      certReadable: boolean;
      keyReadable: boolean;
    };
  }> {
    const { existsSync, readFileSync } = require('fs');
    
    const details = {
      certExists: existsSync(certPath),
      keyExists: existsSync(keyPath),
      certReadable: false,
      keyReadable: false
    };

    try {
      if (details.certExists) {
        readFileSync(certPath);
        details.certReadable = true;
      }
      
      if (details.keyExists) {
        readFileSync(keyPath);
        details.keyReadable = true;
      }

      const valid = details.certExists && details.keyExists && 
                   details.certReadable && details.keyReadable;

      return {
        valid,
        error: valid ? undefined : 'SSL certificates not found or not readable',
        details
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
        details
      };
    }
  }

  /**
   * Get WebRTC test configuration for HTTPS environment
   */
  static getWebRTCTestConfig(httpsUrl: string): {
    iceServers: RTCIceServer[];
    httpsUrl: string;
    allowInsecure: boolean;
    constraints: {
      audio: boolean;
      video: boolean;
    };
  } {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      httpsUrl,
      allowInsecure: true, // For self-signed certificates in testing
      constraints: {
        audio: true,
        video: false // Audio-only for jam band testing
      }
    };
  }
}

/**
 * HTTPS WebRTC Test Helper
 * Provides utilities for testing WebRTC functionality over HTTPS
 */
export class HTTPSWebRTCTestHelper {
  private httpsEnv: HTTPSTestEnvironment;

  constructor(httpsEnv: HTTPSTestEnvironment) {
    this.httpsEnv = httpsEnv;
  }

  /**
   * Test WebRTC connection establishment over HTTPS
   */
  async testWebRTCConnection(
    socket1: any,
    socket2: any,
    roomId: string
  ): Promise<{
    success: boolean;
    latency: number;
    sslHandshakeTime: number;
    webrtcHandshakeTime: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      // Simulate SSL handshake time (1-5ms for localhost)
      const sslStart = Date.now();
      await new Promise(resolve => setTimeout(resolve, Math.random() * 4 + 1));
      const sslHandshakeTime = Date.now() - sslStart;

      // Test WebRTC connection
      const webrtcStart = Date.now();
      const result = await this.httpsEnv.simulateHTTPSWebRTCConnection(socket1, socket2, roomId);
      const webrtcHandshakeTime = Date.now() - webrtcStart;

      const totalLatency = Date.now() - startTime;

      return {
        success: result.success,
        latency: totalLatency,
        sslHandshakeTime,
        webrtcHandshakeTime,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        latency: Date.now() - startTime,
        sslHandshakeTime: 0,
        webrtcHandshakeTime: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test multiple concurrent WebRTC connections over HTTPS
   */
  async testConcurrentConnections(
    connectionCount: number,
    roomId: string
  ): Promise<{
    successfulConnections: number;
    failedConnections: number;
    averageLatency: number;
    maxLatency: number;
    minLatency: number;
    results: Array<{
      success: boolean;
      latency: number;
      error?: string;
    }>;
  }> {
    const results: Array<{
      success: boolean;
      latency: number;
      error?: string;
    }> = [];

    // Create test users
    const users = await this.httpsEnv.addTestUsersToRoom(roomId, connectionCount);
    
    // Test connections in parallel
    const connectionPromises = [];
    for (let i = 0; i < connectionCount - 1; i++) {
      for (let j = i + 1; j < connectionCount; j++) {
        connectionPromises.push(
          this.testWebRTCConnection(users[i].socket, users[j].socket, roomId)
        );
      }
    }

    const connectionResults = await Promise.all(connectionPromises);
    
    let successfulConnections = 0;
    let failedConnections = 0;
    const latencies: number[] = [];

    for (const result of connectionResults) {
      results.push({
        success: result.success,
        latency: result.latency,
        error: result.error
      });

      if (result.success) {
        successfulConnections++;
        latencies.push(result.latency);
      } else {
        failedConnections++;
      }
    }

    return {
      successfulConnections,
      failedConnections,
      averageLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      maxLatency: latencies.length > 0 ? Math.max(...latencies) : 0,
      minLatency: latencies.length > 0 ? Math.min(...latencies) : 0,
      results
    };
  }

  /**
   * Benchmark HTTPS vs HTTP WebRTC performance
   */
  async benchmarkHTTPSvsHTTP(
    testCount: number = 10
  ): Promise<{
    httpsResults: {
      averageLatency: number;
      successRate: number;
      latencies: number[];
    };
    httpResults: {
      averageLatency: number;
      successRate: number;
      latencies: number[];
    };
    sslOverhead: number;
    recommendation: string;
  }> {
    // Test HTTPS performance
    const httpsLatencies: number[] = [];
    let httpsSuccesses = 0;

    for (let i = 0; i < testCount; i++) {
      const { room } = await this.httpsEnv.createTestRoom(`HTTPS Test Room ${i}`);
      const users = await this.httpsEnv.addTestUsersToRoom(room.id, 2);
      
      const result = await this.testWebRTCConnection(users[0].socket, users[1].socket, room.id);
      
      if (result.success) {
        httpsSuccesses++;
        httpsLatencies.push(result.latency);
      }
    }

    // Test HTTP performance for comparison
    const httpEnv = HTTPSTestConfigFactory.createHTTPForComparison();
    await httpEnv.initialize();

    const httpLatencies: number[] = [];
    let httpSuccesses = 0;

    for (let i = 0; i < testCount; i++) {
      const { room } = await httpEnv.createTestRoom(`HTTP Test Room ${i}`);
      const users = await httpEnv.addTestUsersToRoom(room.id, 2);
      
      const startTime = Date.now();
      await httpEnv.simulateWebRTCConnection(users[0].socket, users[1].socket, room.id);
      const latency = Date.now() - startTime;
      
      httpSuccesses++;
      httpLatencies.push(latency);
    }

    await httpEnv.cleanup();

    const httpsAverage = httpsLatencies.length > 0 ? 
      httpsLatencies.reduce((a, b) => a + b, 0) / httpsLatencies.length : 0;
    const httpAverage = httpLatencies.length > 0 ? 
      httpLatencies.reduce((a, b) => a + b, 0) / httpLatencies.length : 0;

    const sslOverhead = httpsAverage - httpAverage;
    
    let recommendation = '';
    if (sslOverhead < 5) {
      recommendation = 'SSL overhead is minimal (<5ms). HTTPS is recommended for production.';
    } else if (sslOverhead < 20) {
      recommendation = 'SSL overhead is acceptable (<20ms). HTTPS is still recommended.';
    } else {
      recommendation = 'SSL overhead is significant (>20ms). Consider optimizing SSL configuration.';
    }

    return {
      httpsResults: {
        averageLatency: httpsAverage,
        successRate: httpsSuccesses / testCount,
        latencies: httpsLatencies
      },
      httpResults: {
        averageLatency: httpAverage,
        successRate: httpSuccesses / testCount,
        latencies: httpLatencies
      },
      sslOverhead,
      recommendation
    };
  }
}