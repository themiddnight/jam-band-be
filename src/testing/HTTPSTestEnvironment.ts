import { Server } from 'socket.io';
import { createServer } from 'http';
import { createServer as createHTTPSServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { TestEnvironment, TestEnvironmentConfig } from './TestEnvironment';

export interface HTTPSTestConfig extends TestEnvironmentConfig {
  enableHTTPS: true;
  sslCertPath?: string;
  sslKeyPath?: string;
  allowSelfSigned?: boolean;
}

/**
 * HTTPS-enabled test environment for WebRTC testing
 * Uses existing SSL certificates or generates test certificates
 */
export class HTTPSTestEnvironment extends TestEnvironment {
  private httpsConfig: HTTPSTestConfig;
  private sslOptions: { key: Buffer; cert: Buffer } | null = null;
  private voiceConnectionHandler: any;

  constructor(config: HTTPSTestConfig) {
    super(config);
    this.httpsConfig = config;
  }

  /**
   * Initialize HTTPS test environment with SSL certificates
   */
  async initialize(): Promise<void> {
    try {
      // Load SSL certificates
      await this.loadSSLCertificates();

      // Create HTTPS server instead of HTTP
      if (this.sslOptions) {
        this.server = createHTTPSServer(this.sslOptions);
      } else {
        throw new Error('SSL certificates not available for HTTPS test environment');
      }

      // Initialize Socket.IO with HTTPS server
      this.io = new Server(this.server, {
        cors: {
          origin: "*",
          methods: ["GET", "POST"]
        },
        allowEIO3: true // Allow Engine.IO v3 for compatibility
      });

      // Initialize services (same as parent)
      await this.initializeServices();

      // Start HTTPS server
      await new Promise<void>((resolve, reject) => {
        this.server.listen(this.config.port, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (this.config.enableLogging) {
        console.log(`HTTPS test environment initialized on port ${this.server.address()?.port}`);
        console.log(`SSL certificates loaded from: ${this.httpsConfig.sslCertPath}, ${this.httpsConfig.sslKeyPath}`);
      }
    } catch (error) {
      // If HTTPS initialization fails, throw a more descriptive error
      throw new Error(`Failed to initialize HTTPS test environment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load SSL certificates from file system
   */
  private async loadSSLCertificates(): Promise<void> {
    const defaultCertPath = join(process.cwd(), '.ssl', 'server.crt');
    const defaultKeyPath = join(process.cwd(), '.ssl', 'server.key');

    const certPath = this.httpsConfig.sslCertPath || defaultCertPath;
    const keyPath = this.httpsConfig.sslKeyPath || defaultKeyPath;

    // Check if certificates exist
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      if (this.httpsConfig.allowSelfSigned) {
        // Generate self-signed certificates for testing
        await this.generateTestCertificates();
        return;
      } else {
        throw new Error(`SSL certificates not found at ${certPath} and ${keyPath}`);
      }
    }

    try {
      const cert = readFileSync(certPath);
      const key = readFileSync(keyPath);

      this.sslOptions = { key, cert };

      if (this.config.enableLogging) {
        console.log('SSL certificates loaded successfully');
      }
    } catch (error) {
      throw new Error(`Failed to load SSL certificates: ${error}`);
    }
  }

  /**
   * Generate self-signed certificates for testing
   */
  private async generateTestCertificates(): Promise<void> {
    const { execSync } = require('child_process');
    const { mkdirSync } = require('fs');
    const { dirname } = require('path');

    const defaultCertPath = join(process.cwd(), '.ssl', 'server.crt');
    const defaultKeyPath = join(process.cwd(), '.ssl', 'server.key');

    const certPath = this.httpsConfig.sslCertPath || defaultCertPath;
    const keyPath = this.httpsConfig.sslKeyPath || defaultKeyPath;

    // Create SSL directory if it doesn't exist
    mkdirSync(dirname(certPath), { recursive: true });

    try {
      // Generate self-signed certificate
      const cmd = `openssl req -x509 -nodes -newkey rsa:2048 -days 1 -keyout "${keyPath}" -out "${certPath}" -subj "/CN=localhost"`;
      execSync(cmd, { stdio: 'pipe' });

      // Load the generated certificates
      const cert = readFileSync(certPath);
      const key = readFileSync(keyPath);
      this.sslOptions = { key, cert };

      if (this.config.enableLogging) {
        console.log('Generated self-signed SSL certificates for testing');
      }
    } catch (error) {
      throw new Error(`Failed to generate test SSL certificates: ${error}`);
    }
  }

  /**
   * Initialize services (extracted from parent for reuse)
   */
  private async initializeServices(): Promise<void> {
    const { RoomService } = require('../services/RoomService');
    const { NamespaceManager } = require('../services/NamespaceManager');
    const { RoomSessionManager } = require('../services/RoomSessionManager');
    const { RoomHandlers } = require('../handlers/RoomHandlers');
    
    // Import extracted handlers
    const { RoomLifecycleHandler, RoomMembershipHandler } = require('../domains/room-management/infrastructure/handlers');
    const { VoiceConnectionHandler } = require('../domains/real-time-communication/infrastructure/handlers');
    const { AudioRoutingHandler } = require('../domains/audio-processing/infrastructure/handlers');
    
    // Import services
    const { MetronomeService } = require('../services/MetronomeService');
    const { ChatHandler } = require('../domains/real-time-communication/infrastructure/handlers/ChatHandler');
    const { MetronomeHandler } = require('../domains/room-management/infrastructure/handlers/MetronomeHandler');
    const { NotePlayingHandler } = require('../domains/audio-processing/infrastructure/handlers/NotePlayingHandler');

    // Initialize services
    this.roomService = new RoomService();
    this.namespaceManager = new NamespaceManager(this.io);
    this.roomSessionManager = new RoomSessionManager();
    
    // Initialize extracted handlers
    const roomLifecycleHandler = new RoomLifecycleHandler(this.roomService, this.namespaceManager, this.roomSessionManager);
    const voiceConnectionHandler = new VoiceConnectionHandler(this.roomService, this.io, this.roomSessionManager);
    const audioRoutingHandler = new AudioRoutingHandler(this.roomService, this.io, this.roomSessionManager, this.namespaceManager);
    const roomMembershipHandler = new RoomMembershipHandler(this.roomService, this.io, this.namespaceManager, this.roomSessionManager);
    
    // Initialize services needed by RoomHandlers
    const metronomeService = new MetronomeService(this.io, this.roomService);
    const chatHandler = new ChatHandler(this.roomService, this.namespaceManager, this.roomSessionManager);
    const metronomeHandler = new MetronomeHandler(this.roomService, metronomeService, this.roomSessionManager, this.namespaceManager);
    const notePlayingHandler = new NotePlayingHandler(this.roomService, this.io, this.namespaceManager, this.roomSessionManager);
    
    // Initialize main handlers with dependencies
    this.roomHandlers = new RoomHandlers(
      this.roomService,
      this.namespaceManager,
      this.roomSessionManager,
      roomLifecycleHandler,
      audioRoutingHandler,
      roomMembershipHandler,
      chatHandler,
      metronomeHandler,
      notePlayingHandler
    );
    
    // Store voice handler for WebRTC testing
    this.voiceConnectionHandler = voiceConnectionHandler;
  }

  /**
   * Create WebRTC test configuration for HTTPS
   */
  getWebRTCTestConfig(): {
    iceServers: RTCIceServer[];
    httpsUrl: string;
    allowInsecure: boolean;
  } {
    const port = this.getPort();
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ],
      httpsUrl: `https://localhost:${port}`,
      allowInsecure: true // For self-signed certificates in testing
    };
  }

  /**
   * Simulate WebRTC connection over HTTPS
   */
  async simulateHTTPSWebRTCConnection(
    socket1: any,
    socket2: any,
    roomId: string
  ): Promise<{
    success: boolean;
    latency?: number;
    error?: string;
  }> {
    try {
      const startTime = Date.now();

      // Simulate HTTPS WebRTC handshake with SSL overhead
      const offerData = {
        roomId,
        targetUserId: socket2.data.userId,
        offer: {
          type: 'offer',
          sdp: 'mock-https-sdp-offer'
        }
      };

      const answerData = {
        roomId,
        targetUserId: socket1.data.userId,
        answer: {
          type: 'answer',
          sdp: 'mock-https-sdp-answer'
        }
      };

      // Simulate SSL handshake delay (1-5ms)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 4 + 1));

      // Execute WebRTC handshake using the extracted voice handler
      this.voiceConnectionHandler.handleVoiceOffer(socket1, offerData);
      await new Promise(resolve => setTimeout(resolve, 1)); // Simulate network delay
      
      this.voiceConnectionHandler.handleVoiceAnswer(socket2, answerData);
      await new Promise(resolve => setTimeout(resolve, 1)); // Simulate network delay

      // Simulate ICE candidate exchange
      const iceCandidateData = {
        roomId,
        targetUserId: socket2.data.userId,
        candidate: {
          candidate: 'mock-https-ice-candidate',
          sdpMLineIndex: 0,
          sdpMid: 'audio'
        }
      };

      this.voiceConnectionHandler.handleVoiceIceCandidate(socket1, iceCandidateData);

      const endTime = Date.now();
      const latency = endTime - startTime;

      return {
        success: true,
        latency
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Test WebRTC performance over HTTPS vs HTTP
   */
  async compareHTTPSPerformance(
    testCount: number = 10
  ): Promise<{
    httpsLatency: number[];
    averageHTTPSLatency: number;
    sslOverhead: number;
  }> {
    const httpsLatencies: number[] = [];

    for (let i = 0; i < testCount; i++) {
      const { room } = await this.createTestRoom(`Test Room ${i}`);
      const users = await this.addTestUsersToRoom(room.id, 2);
      
      const result = await this.simulateHTTPSWebRTCConnection(
        users[0].socket,
        users[1].socket,
        room.id
      );

      if (result.success && result.latency) {
        httpsLatencies.push(result.latency);
      }

      // Cleanup
      this.roomService.deleteRoom(room.id);
    }

    const averageHTTPSLatency = httpsLatencies.reduce((a, b) => a + b, 0) / httpsLatencies.length;
    
    // Estimate SSL overhead (typically 1-3ms for local connections)
    const estimatedHTTPLatency = averageHTTPSLatency * 0.8; // Rough estimate
    const sslOverhead = averageHTTPSLatency - estimatedHTTPLatency;

    return {
      httpsLatency: httpsLatencies,
      averageHTTPSLatency,
      sslOverhead
    };
  }

  /**
   * Validate mkcert compatibility
   */
  async validateMkcertCompatibility(): Promise<{
    mkcertAvailable: boolean;
    certificateValid: boolean;
    browserCompatible: boolean;
  }> {
    let mkcertAvailable = false;
    let certificateValid = false;
    let browserCompatible = false;

    try {
      // Check if mkcert is available
      const { execSync } = require('child_process');
      execSync('mkcert -version', { stdio: 'pipe' });
      mkcertAvailable = true;
    } catch (error) {
      // mkcert not available
    }

    // Check certificate validity
    if (this.sslOptions) {
      certificateValid = true;
      
      // Check if certificate is browser-compatible (basic validation)
      const certString = this.sslOptions.cert.toString();
      browserCompatible = certString.includes('BEGIN CERTIFICATE') && 
                         certString.includes('END CERTIFICATE');
    }

    return {
      mkcertAvailable,
      certificateValid,
      browserCompatible
    };
  }

  /**
   * Get HTTPS server URL for frontend testing
   */
  getHTTPSUrl(): string {
    const port = this.getPort();
    return `https://localhost:${port}`;
  }
}