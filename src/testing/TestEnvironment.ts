import { Server } from 'socket.io';
import { createServer } from 'http';
import { RoomService } from '../services/RoomService';
import { NamespaceManager } from '../services/NamespaceManager';
import { RoomSessionManager } from '../services/RoomSessionManager';
import { RoomHandlers } from '../handlers/RoomHandlers';
import { MockSocket, MockSocketFactory } from './MockSocket';
import { ParallelTestHarness } from './ParallelTestHarness';

import { MetronomeService } from '../services/MetronomeService';
import { ChatHandler } from '../domains/real-time-communication/infrastructure/handlers/ChatHandler';
import { MetronomeHandler } from '../domains/room-management/infrastructure/handlers/MetronomeHandler';
import { NotePlayingHandler } from '../domains/audio-processing/infrastructure/handlers/NotePlayingHandler';

export interface TestEnvironmentConfig {
  enableHTTPS?: boolean;
  sslCertPath?: string;
  sslKeyPath?: string;
  port?: number;
  enableLogging?: boolean;
}

/**
 * Test environment for setting up isolated testing scenarios
 * Supports both HTTP and HTTPS configurations for WebRTC testing
 */
export class TestEnvironment {
  protected server: any;
  protected io!: Server;
  protected roomService!: RoomService;
  protected namespaceManager!: NamespaceManager;
  protected roomSessionManager!: RoomSessionManager;
  protected roomHandlers!: RoomHandlers;
  protected voiceConnectionHandler: any;
  private testHarness: ParallelTestHarness;
  protected config: TestEnvironmentConfig;

  constructor(config: TestEnvironmentConfig = {}) {
    this.config = {
      enableHTTPS: false,
      port: 0, // Use random port for testing
      enableLogging: false,
      ...config
    };
    
    this.testHarness = new ParallelTestHarness();
  }

  /**
   * Initialize the test environment
   */
  async initialize(): Promise<void> {
    // Create HTTP server
    this.server = createServer();
    
    // Initialize Socket.IO
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize services
    this.roomSessionManager = new RoomSessionManager();
    this.roomService = new RoomService(this.roomSessionManager);
    this.namespaceManager = new NamespaceManager(this.io);
    
    // Import extracted handlers
    const { RoomLifecycleHandler, RoomMembershipHandler } = require('../domains/room-management/infrastructure/handlers');
    const { VoiceConnectionHandler } = require('../domains/real-time-communication/infrastructure/handlers');
    const { AudioRoutingHandler } = require('../domains/audio-processing/infrastructure/handlers');
    
    // Initialize extracted handlers
    const roomLifecycleHandler = new RoomLifecycleHandler(this.roomService, this.namespaceManager, this.roomSessionManager);
    const voiceConnectionHandler = new VoiceConnectionHandler(this.roomService, this.io, this.namespaceManager, this.roomSessionManager);
    const audioRoutingHandler = new AudioRoutingHandler(this.roomService, this.io, this.namespaceManager, this.roomSessionManager);
    const roomMembershipHandler = new RoomMembershipHandler(this.roomService, this.namespaceManager, this.roomSessionManager);
    
    // Initialize services needed by RoomHandlers
    const metronomeService = new MetronomeService(this.io, this.roomService);
    const chatHandler = new ChatHandler(this.roomService, this.namespaceManager, this.roomSessionManager);
    const metronomeHandler = new MetronomeHandler(this.roomService, metronomeService, this.roomSessionManager, this.namespaceManager);
    const notePlayingHandler = new NotePlayingHandler(this.roomService, this.io, this.namespaceManager, this.roomSessionManager);
    
    // Initialize handlers
    this.roomHandlers = new RoomHandlers(
      this.roomService,
      this.namespaceManager,
      this.roomSessionManager,
      roomLifecycleHandler
    );
    
    // Store voice handler for WebRTC testing
    this.voiceConnectionHandler = voiceConnectionHandler;

    // Start server on random port for testing
    await new Promise<void>((resolve, reject) => {
      this.server.listen(this.config.port, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (this.config.enableLogging) {
      console.log(`Test environment initialized on port ${this.server.address()?.port}`);
    }
  }

  /**
   * Create a mock socket for testing
   */
  createMockSocket(id?: string): MockSocket {
    return MockSocketFactory.createSocket(id);
  }

  /**
   * Create a mock socket with session data
   */
  createMockSocketWithSession(roomId: string, userId: string, id?: string): MockSocket {
    return MockSocketFactory.createSocketWithSession(roomId, userId, id);
  }

  /**
   * Create multiple mock sockets for multi-user testing
   */
  createMultipleMockSockets(count: number, roomId?: string): MockSocket[] {
    return MockSocketFactory.createMultipleSockets(count, roomId);
  }

  /**
   * Get the test harness for parallel testing
   */
  getTestHarness(): ParallelTestHarness {
    return this.testHarness;
  }

  /**
   * Get room service instance
   */
  getRoomService(): RoomService {
    return this.roomService;
  }

  /**
   * Get room handlers instance
   */
  getRoomHandlers(): RoomHandlers {
    return this.roomHandlers;
  }

  /**
   * Get namespace manager instance
   */
  getNamespaceManager(): NamespaceManager {
    return this.namespaceManager;
  }

  /**
   * Get room session manager instance
   */
  getRoomSessionManager(): RoomSessionManager {
    return this.roomSessionManager;
  }

  /**
   * Create a test room with users
   */
  async createTestRoom(
    roomName: string = 'Test Room',
    ownerUsername: string = 'testowner',
    ownerId: string = 'owner123',
    isPrivate: boolean = false
  ): Promise<{ room: any; owner: any }> {
    const { room, user } = this.roomService.createRoom(
      roomName,
      ownerUsername,
      ownerId,
      isPrivate
    );

    // Create room namespace
    this.namespaceManager.createRoomNamespace(room.id);
    
    if (isPrivate) {
      this.namespaceManager.createApprovalNamespace(room.id);
    }

    return { room, owner: user };
  }

  /**
   * Add test users to a room
   */
  async addTestUsersToRoom(
    roomId: string,
    userCount: number = 3
  ): Promise<Array<{ socket: MockSocket; user: any }>> {
    const users: Array<{ socket: MockSocket; user: any }> = [];

    for (let i = 1; i <= userCount; i++) {
      const userId = `user${i}`;
      const username = `TestUser${i}`;
      const socket = this.createMockSocketWithSession(roomId, userId);
      
      const user = {
        id: userId,
        username,
        role: 'audience' as const,
        isReady: true
      };

      this.roomService.addUserToRoom(roomId, user);
      this.roomSessionManager.setRoomSession(roomId, socket.id, { roomId, userId });
      
      users.push({ socket, user });
    }

    return users;
  }

  /**
   * Simulate WebRTC connection setup for testing
   */
  async simulateWebRTCConnection(
    socket1: MockSocket,
    socket2: MockSocket,
    roomId: string
  ): Promise<void> {
    // Simulate WebRTC offer/answer exchange
    const offerData = {
      roomId,
      targetUserId: socket2.data.userId,
      offer: {
        type: 'offer',
        sdp: 'mock-sdp-offer'
      }
    };

    const answerData = {
      roomId,
      targetUserId: socket1.data.userId,
      answer: {
        type: 'answer',
        sdp: 'mock-sdp-answer'
      }
    };

    // Simulate the WebRTC handshake using extracted voice handler
    this.voiceConnectionHandler.handleVoiceOffer(socket1 as any, offerData);
    this.voiceConnectionHandler.handleVoiceAnswer(socket2 as any, answerData);

    // Simulate ICE candidates
    const iceCandidateData = {
      roomId,
      targetUserId: socket2.data.userId,
      candidate: {
        candidate: 'mock-ice-candidate',
        sdpMLineIndex: 0,
        sdpMid: 'audio'
      }
    };

    this.voiceConnectionHandler.handleVoiceIceCandidate(socket1 as any, iceCandidateData);
  }

  /**
   * Clean up test environment
   */
  async cleanup(): Promise<void> {
    try {
      // Clear all rooms
      if (this.roomService) {
        const rooms = this.roomService.getAllRooms();
        for (const room of rooms) {
          this.roomService.deleteRoom(room.id);
          if (this.namespaceManager) {
            this.namespaceManager.cleanupRoomNamespace(room.id);
            this.namespaceManager.cleanupApprovalNamespace(room.id);
          }
        }
      }

      // Shutdown namespace manager to clear intervals
      if (this.namespaceManager) {
        this.namespaceManager.shutdown();
      }

      // Shutdown grace period manager
      const { namespaceGracePeriodManager } = require('../services/NamespaceGracePeriodManager');
      if (namespaceGracePeriodManager && typeof namespaceGracePeriodManager.shutdown === 'function') {
        namespaceGracePeriodManager.shutdown();
      }

      // Clear test harness results
      if (this.testHarness) {
        this.testHarness.clearResults();
      }

      // Close Socket.IO server
      if (this.io) {
        await new Promise<void>((resolve) => {
          this.io.close(() => resolve());
        });
      }

      // Close HTTP server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server.close(() => resolve());
        });
      }

      if (this.config.enableLogging) {
        console.log('Test environment cleaned up');
      }
    } catch (error) {
      console.error('Error during test environment cleanup:', error);
    }
  }

  /**
   * Get server port for external connections
   */
  getPort(): number | undefined {
    return this.server?.address()?.port;
  }

  /**
   * Check if HTTPS is enabled
   */
  isHTTPSEnabled(): boolean {
    return this.config.enableHTTPS || false;
  }
}