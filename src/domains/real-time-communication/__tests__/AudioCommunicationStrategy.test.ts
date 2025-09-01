/**
 * Tests for Audio Communication Strategy Foundation
 * 
 * Tests the hybrid communication strategy implementation including:
 * - MeshWebRTCStrategy for band members
 * - StreamingStrategy for audience
 * - AudioCommunicationService coordination
 * 
 * Requirements: 10.2, 10.3
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Server } from 'socket.io';
import { MeshWebRTCStrategy } from '../infrastructure/strategies/MeshWebRTCStrategy';
import { StreamingStrategy } from '../infrastructure/strategies/StreamingStrategy';
import { 
  AudioCommunicationService, 
  DefaultCommunicationStrategyFactory 
} from '../application/AudioCommunicationService';
import { 
  UserRole, 
  ConnectionId, 
  AudioBuffer 
} from '../domain/models/Connection';
import { 
  InvalidRoleError, 
  ConnectionFailedError,
  UnsupportedOperationError 
} from '../domain/services/AudioCommunicationStrategy';

// Mock dependencies
const mockIo = {
  sockets: {
    sockets: new Map()
  }
} as unknown as Server;

const mockRoomSessionManager = {
  findSocketByUserId: jest.fn(),
  getRoomSessions: jest.fn(() => new Map())
};

describe('Audio Communication Strategy Foundation', () => {
  describe('MeshWebRTCStrategy', () => {
    let meshStrategy: MeshWebRTCStrategy;
    const roomId = 'test-room-123';

    beforeEach(() => {
      meshStrategy = new MeshWebRTCStrategy(mockIo, mockRoomSessionManager as any, roomId);
    });

    it('should connect band members successfully', async () => {
      const userId = 'user-123';
      const role = UserRole.BAND_MEMBER;

      const connectionId = await meshStrategy.connect(userId, role);

      expect(connectionId).toBeInstanceOf(ConnectionId);
      expect(meshStrategy.getConnectedUsersCount()).toBe(1);
    });

    it('should connect room owners successfully', async () => {
      const userId = 'owner-123';
      const role = UserRole.ROOM_OWNER;

      const connectionId = await meshStrategy.connect(userId, role);

      expect(connectionId).toBeInstanceOf(ConnectionId);
      expect(meshStrategy.getConnectedUsersCount()).toBe(1);
    });

    it('should reject audience members', async () => {
      const userId = 'audience-123';
      const role = UserRole.AUDIENCE;

      await expect(meshStrategy.connect(userId, role)).rejects.toThrow(InvalidRoleError);
    });

    it('should disconnect users successfully', async () => {
      const userId = 'user-123';
      const connectionId = await meshStrategy.connect(userId, UserRole.BAND_MEMBER);

      await meshStrategy.disconnect(connectionId);

      expect(meshStrategy.getConnectedUsersCount()).toBe(0);
    });

    it('should provide correct strategy info', () => {
      const info = meshStrategy.getStrategyInfo();

      expect(info.type).toBe('mesh');
      expect(info.maxConnections).toBe(8);
      expect(info.supportedRoles).toContain(UserRole.BAND_MEMBER);
      expect(info.supportedRoles).toContain(UserRole.ROOM_OWNER);
    });

    it('should handle audio sending for connected users', async () => {
      const userId = 'user-123';
      const connectionId = await meshStrategy.connect(userId, UserRole.BAND_MEMBER);

      const audioData: AudioBuffer = {
        data: new ArrayBuffer(1024),
        sampleRate: 44100,
        channels: 2,
        timestamp: Date.now()
      };

      // Should not throw for healthy connection
      await expect(meshStrategy.sendAudio(connectionId, audioData)).resolves.toBeUndefined();
    });

    it('should measure connection health', async () => {
      const userId = 'user-123';
      const connectionId = await meshStrategy.connect(userId, UserRole.BAND_MEMBER);

      const health = await meshStrategy.getConnectionHealth(connectionId);

      expect(health.isHealthy).toBe(true);
      expect(health.latency).toBeGreaterThan(0);
      expect(['excellent', 'good', 'poor']).toContain(health.quality);
    });
  });

  describe('StreamingStrategy', () => {
    let streamingStrategy: StreamingStrategy;
    const roomId = 'test-room-456';

    beforeEach(() => {
      streamingStrategy = new StreamingStrategy(roomId);
    });

    it('should connect audience members successfully', async () => {
      const userId = 'audience-123';
      const role = UserRole.AUDIENCE;

      const connectionId = await streamingStrategy.connect(userId, role);

      expect(connectionId).toBeInstanceOf(ConnectionId);
      expect(streamingStrategy.getSubscriberCount()).toBe(1);
    });

    it('should reject band members', async () => {
      const userId = 'band-123';
      const role = UserRole.BAND_MEMBER;

      await expect(streamingStrategy.connect(userId, role)).rejects.toThrow(InvalidRoleError);
    });

    it('should reject audio sending from audience', async () => {
      const userId = 'audience-123';
      const connectionId = await streamingStrategy.connect(userId, UserRole.AUDIENCE);

      const audioData: AudioBuffer = {
        data: new ArrayBuffer(1024),
        sampleRate: 44100,
        channels: 2,
        timestamp: Date.now()
      };

      await expect(streamingStrategy.sendAudio(connectionId, audioData))
        .rejects.toThrow(UnsupportedOperationError);
    });

    it('should provide correct strategy info', () => {
      const info = streamingStrategy.getStrategyInfo();

      expect(info.type).toBe('streaming');
      expect(info.maxConnections).toBe(1000);
      expect(info.supportedRoles).toContain(UserRole.AUDIENCE);
    });

    it('should disconnect audience members successfully', async () => {
      const userId = 'audience-123';
      const connectionId = await streamingStrategy.connect(userId, UserRole.AUDIENCE);

      await streamingStrategy.disconnect(connectionId);

      expect(streamingStrategy.getSubscriberCount()).toBe(0);
    });
  });

  describe('AudioCommunicationService', () => {
    let audioService: AudioCommunicationService;
    let strategyFactory: DefaultCommunicationStrategyFactory;

    beforeEach(() => {
      strategyFactory = new DefaultCommunicationStrategyFactory(mockIo, mockRoomSessionManager as any);
      audioService = new AudioCommunicationService(strategyFactory, mockIo, mockRoomSessionManager as any);
    });

    it('should connect band members using mesh strategy', async () => {
      const userId = 'band-123';
      const role = UserRole.BAND_MEMBER;
      const roomId = 'room-123';

      const connectionId = await audioService.connectUser(userId, role, roomId);

      expect(connectionId).toBeInstanceOf(ConnectionId);
      
      const strategyInfo = audioService.getStrategyInfo(roomId);
      expect(strategyInfo?.type).toBe('mesh');
    });

    it('should connect audience members using streaming strategy', async () => {
      const userId = 'audience-123';
      const role = UserRole.AUDIENCE;
      const roomId = 'room-456';

      const connectionId = await audioService.connectUser(userId, role, roomId);

      expect(connectionId).toBeInstanceOf(ConnectionId);
      
      const strategyInfo = audioService.getStrategyInfo(roomId);
      expect(strategyInfo?.type).toBe('streaming');
    });

    it('should disconnect users successfully', async () => {
      const userId = 'user-123';
      const role = UserRole.BAND_MEMBER;
      const roomId = 'room-123';

      await audioService.connectUser(userId, role, roomId);
      await audioService.disconnectUser(userId);

      // Should not throw when getting health of disconnected user
      const health = await audioService.getConnectionHealth(userId);
      expect(health.isHealthy).toBe(false);
    });

    it('should handle audio sending through appropriate strategy', async () => {
      const userId = 'band-123';
      const role = UserRole.BAND_MEMBER;
      const roomId = 'room-123';

      await audioService.connectUser(userId, role, roomId);

      const audioData: AudioBuffer = {
        data: new ArrayBuffer(1024),
        sampleRate: 44100,
        channels: 2,
        timestamp: Date.now()
      };

      // Should not throw for band member
      await expect(audioService.sendAudio(userId, audioData)).resolves.toBeUndefined();
    });

    it('should clean up room resources', async () => {
      const roomId = 'room-cleanup';
      const userId1 = 'user-1';
      const userId2 = 'user-2';

      await audioService.connectUser(userId1, UserRole.BAND_MEMBER, roomId);
      await audioService.connectUser(userId2, UserRole.BAND_MEMBER, roomId);

      await audioService.cleanupRoom(roomId);

      // Strategy info should be null after cleanup
      expect(audioService.getStrategyInfo(roomId)).toBeNull();
    });
  });

  describe('DefaultCommunicationStrategyFactory', () => {
    let factory: DefaultCommunicationStrategyFactory;

    beforeEach(() => {
      factory = new DefaultCommunicationStrategyFactory(mockIo, mockRoomSessionManager as any);
    });

    it('should create mesh strategy for band members', () => {
      const roomContext = {
        bandMemberCount: 3,
        audienceCount: 0,
        requiresLowLatency: true
      };

      const strategy = factory.createStrategy(UserRole.BAND_MEMBER, roomContext);
      expect(strategy.getStrategyInfo().type).toBe('mesh');
    });

    it('should create streaming strategy for audience', () => {
      const roomContext = {
        bandMemberCount: 3,
        audienceCount: 10,
        requiresLowLatency: false
      };

      const strategy = factory.createStrategy(UserRole.AUDIENCE, roomContext);
      expect(strategy.getStrategyInfo().type).toBe('streaming');
    });

    it('should throw error for unsupported roles', () => {
      const roomContext = {
        bandMemberCount: 0,
        audienceCount: 0,
        requiresLowLatency: false
      };

      expect(() => factory.createStrategy('invalid_role' as UserRole, roomContext))
        .toThrow(InvalidRoleError);
    });
  });

  describe('Domain Models', () => {
    it('should create valid ConnectionId', () => {
      const id1 = ConnectionId.generate();
      const id2 = ConnectionId.generate();

      expect(id1.toString()).toBeTruthy();
      expect(id2.toString()).toBeTruthy();
      expect(id1.equals(id2)).toBe(false);
    });

    it('should reject empty ConnectionId', () => {
      expect(() => new ConnectionId('')).toThrow('ConnectionId cannot be empty');
      expect(() => new ConnectionId('   ')).toThrow('ConnectionId cannot be empty');
    });

    it('should compare ConnectionIds correctly', () => {
      const id1 = new ConnectionId('test-id-1');
      const id2 = new ConnectionId('test-id-1');
      const id3 = new ConnectionId('test-id-2');

      expect(id1.equals(id2)).toBe(true);
      expect(id1.equals(id3)).toBe(false);
    });
  });
});