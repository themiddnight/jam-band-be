/**
 * Example: Hybrid Communication Strategy Integration
 * 
 * This example shows how the new hybrid communication strategy foundation
 * can be integrated with the existing VoiceConnectionHandler to support
 * both mesh WebRTC for band members and streaming for audience.
 * 
 * Requirements: 10.2, 10.3
 */

import { Server } from 'socket.io';
import { 
  AudioCommunicationService,
  DefaultCommunicationStrategyFactory,
  UserRole,
  AudioBuffer
} from '../index';
import { RoomSessionManager } from '../../../services/RoomSessionManager';
import { VoiceConnectionHandler } from '../infrastructure/handlers/VoiceConnectionHandler';

/**
 * Enhanced Voice Connection Handler with Hybrid Communication
 * 
 * This shows how the existing VoiceConnectionHandler can be enhanced
 * to use the new hybrid communication strategies.
 */
export class HybridVoiceConnectionHandler extends VoiceConnectionHandler {
  private audioCommunicationService: AudioCommunicationService;

  constructor(
    roomService: any,
    io: Server,
    roomSessionManager: RoomSessionManager
  ) {
    super(roomService, io, roomSessionManager);
    
    // Initialize hybrid communication service
    const strategyFactory = new DefaultCommunicationStrategyFactory(io, roomSessionManager);
    this.audioCommunicationService = new AudioCommunicationService(
      strategyFactory,
      io,
      roomSessionManager
    );
  }

  /**
   * Enhanced join voice with hybrid strategy selection
   */
  async handleJoinVoiceHybrid(socket: any, data: {
    roomId: string;
    userId: string;
    username: string;
    role: 'band_member' | 'audience' | 'room_owner';
  }): Promise<void> {
    // Call original join voice logic
    super.handleJoinVoice(socket, data);

    // Determine user role for strategy selection
    const userRole = this.mapToUserRole(data.role);
    
    try {
      // Connect user through appropriate strategy
      const connectionId = await this.audioCommunicationService.connectUser(
        data.userId,
        userRole,
        data.roomId
      );

      console.log(`[HYBRID] User ${data.userId} connected with ${userRole} strategy, connectionId: ${connectionId.toString()}`);

      // Notify client about connection type
      const strategyInfo = this.audioCommunicationService.getStrategyInfo(data.roomId);
      socket.emit('voice_strategy_selected', {
        strategyType: strategyInfo?.type,
        maxConnections: strategyInfo?.maxConnections,
        connectionId: connectionId.toString()
      });

    } catch (error) {
      console.error(`[HYBRID] Failed to connect user ${data.userId}:`, error);
      socket.emit('voice_connection_error', {
        error: 'Failed to establish voice connection',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Enhanced leave voice with hybrid cleanup
   */
  async handleLeaveVoiceHybrid(socket: any, data: {
    roomId: string;
    userId: string;
  }): Promise<void> {
    // Call original leave voice logic
    super.handleLeaveVoice(socket, data);

    try {
      // Disconnect from hybrid communication service
      await this.audioCommunicationService.disconnectUser(data.userId);
      console.log(`[HYBRID] User ${data.userId} disconnected from hybrid communication`);

    } catch (error) {
      console.error(`[HYBRID] Failed to disconnect user ${data.userId}:`, error);
    }
  }

  /**
   * Handle audio data through hybrid strategies
   */
  async handleAudioData(socket: any, data: {
    userId: string;
    audioData: ArrayBuffer;
    sampleRate: number;
    channels: number;
  }): Promise<void> {
    try {
      const audioBuffer: AudioBuffer = {
        data: data.audioData,
        sampleRate: data.sampleRate,
        channels: data.channels,
        timestamp: Date.now()
      };

      await this.audioCommunicationService.sendAudio(data.userId, audioBuffer);
      
    } catch (error) {
      console.error(`[HYBRID] Failed to send audio for user ${data.userId}:`, error);
      socket.emit('audio_send_error', {
        error: 'Failed to send audio data',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Monitor connection health
   */
  async handleConnectionHealthCheck(socket: any, data: { userId: string }): Promise<void> {
    try {
      const health = await this.audioCommunicationService.getConnectionHealth(data.userId);
      
      socket.emit('connection_health_status', {
        userId: data.userId,
        isHealthy: health.isHealthy,
        latency: health.latency,
        quality: health.quality
      });

      // Attempt recovery if connection is unhealthy
      if (!health.isHealthy) {
        console.log(`[HYBRID] Attempting to recover connection for user ${data.userId}`);
        await this.audioCommunicationService.recoverConnection(data.userId);
      }

    } catch (error) {
      console.error(`[HYBRID] Health check failed for user ${data.userId}:`, error);
      socket.emit('connection_health_error', {
        userId: data.userId,
        error: 'Health check failed'
      });
    }
  }

  /**
   * Clean up room resources
   */
  async cleanupRoomHybrid(roomId: string): Promise<void> {
    // Call original cleanup
    super.cleanupRoom(roomId);

    try {
      // Cleanup hybrid communication resources
      await this.audioCommunicationService.cleanupRoom(roomId);
      console.log(`[HYBRID] Cleaned up hybrid communication for room ${roomId}`);

    } catch (error) {
      console.error(`[HYBRID] Failed to cleanup room ${roomId}:`, error);
    }
  }

  /**
   * Map string role to UserRole enum
   */
  private mapToUserRole(role: string): UserRole {
    switch (role) {
      case 'band_member':
        return UserRole.BAND_MEMBER;
      case 'audience':
        return UserRole.AUDIENCE;
      case 'room_owner':
        return UserRole.ROOM_OWNER;
      default:
        throw new Error(`Unknown role: ${role}`);
    }
  }

  /**
   * Setup audio data reception callback
   */
  setupAudioReception(): void {
    this.audioCommunicationService.onAudioReceived((audioData, fromUserId) => {
      console.log(`[HYBRID] Received audio from ${fromUserId}, size: ${audioData.data.byteLength} bytes`);
      
      // In real implementation, this would process and route the audio
      // to appropriate destinations (other band members, audience stream, etc.)
    });
  }
}

/**
 * Example usage in server setup
 */
export function setupHybridVoiceHandling(io: Server, roomSessionManager: RoomSessionManager, roomService: any): HybridVoiceConnectionHandler {
  const hybridHandler = new HybridVoiceConnectionHandler(roomService, io, roomSessionManager);
  
  // Setup audio reception
  hybridHandler.setupAudioReception();

  // Register enhanced handlers
  io.on('connection', (socket) => {
    socket.on('join_voice_hybrid', (data) => hybridHandler.handleJoinVoiceHybrid(socket, data));
    socket.on('leave_voice_hybrid', (data) => hybridHandler.handleLeaveVoiceHybrid(socket, data));
    socket.on('audio_data', (data) => hybridHandler.handleAudioData(socket, data));
    socket.on('connection_health_check', (data) => hybridHandler.handleConnectionHealthCheck(socket, data));
  });

  console.log('[HYBRID] Hybrid voice communication handlers registered');
  
  return hybridHandler;
}

/**
 * Example room cleanup integration
 */
export async function cleanupRoomWithHybrid(roomId: string, hybridHandler: HybridVoiceConnectionHandler): Promise<void> {
  console.log(`[HYBRID] Starting cleanup for room ${roomId}`);
  
  try {
    await hybridHandler.cleanupRoomHybrid(roomId);
    console.log(`[HYBRID] Successfully cleaned up room ${roomId}`);
  } catch (error) {
    console.error(`[HYBRID] Failed to cleanup room ${roomId}:`, error);
    throw error;
  }
}