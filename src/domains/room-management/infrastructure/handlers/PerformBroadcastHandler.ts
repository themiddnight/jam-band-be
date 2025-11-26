import { Socket, Namespace } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { loggingService } from '../../../../services/LoggingService';
import { hlsBroadcastService } from '../../../../services/HLSBroadcastService';
import { ToggleBroadcastData, BroadcastAudioChunkData } from '../../../../types';

/**
 * Handler for perform room broadcast events
 * Manages audio streaming from room owner to audience members via HLS
 * Audio chunks are transcoded to HLS format using FFmpeg
 */
export class PerformBroadcastHandler {
  constructor(
    private roomService: RoomService,
    private roomSessionManager: RoomSessionManager
  ) {}

  /**
   * Handle broadcast toggle from room owner
   */
  handleToggleBroadcast(socket: Socket, data: ToggleBroadcastData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('broadcast_error', { message: 'No session found' });
      return;
    }

    const { roomId, userId } = session;
    const room = this.roomService.getRoom(roomId);

    if (!room) {
      socket.emit('broadcast_error', { message: 'Room not found' });
      return;
    }

    // Only room owner can toggle broadcast
    if (room.owner !== userId) {
      socket.emit('broadcast_error', { message: 'Only room owner can toggle broadcast' });
      return;
    }

    const { isBroadcasting } = data;

    if (isBroadcasting) {
      // Start HLS broadcast
      const started = hlsBroadcastService.startBroadcast(roomId);
      if (!started) {
        socket.emit('broadcast_error', { message: 'Failed to start broadcast' });
        return;
      }

      this.roomService.toggleBroadcast(roomId, true);
      
      // Get playlist URL for audience
      const playlistUrl = hlsBroadcastService.getPlaylistUrl(roomId);
      
      // Notify all users in the room
      namespace.emit('broadcast_state_changed', {
        isBroadcasting: true,
        playlistUrl,
      });

      // Also emit to lobby namespace for room list updates
      socket.broadcast.emit('room_broadcast_changed', {
        roomId,
        isBroadcasting: true,
      });

      loggingService.logInfo(`HLS broadcast started for room ${roomId}`, { userId, playlistUrl });
    } else {
      // Stop HLS broadcast
      hlsBroadcastService.stopBroadcast(roomId);
      this.roomService.toggleBroadcast(roomId, false);

      // Notify all users in the room
      namespace.emit('broadcast_state_changed', {
        isBroadcasting: false,
        playlistUrl: null,
      });

      // Also emit to lobby namespace for room list updates
      socket.broadcast.emit('room_broadcast_changed', {
        roomId,
        isBroadcasting: false,
      });

      loggingService.logInfo(`HLS broadcast stopped for room ${roomId}`, { userId });
    }
  }

  /**
   * Handle incoming audio chunk from room owner - pipe to FFmpeg for HLS transcoding
   */
  handleBroadcastAudioChunk(socket: Socket, data: BroadcastAudioChunkData, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return; // Silently ignore if no session
    }

    const { roomId, userId } = session;
    const room = this.roomService.getRoom(roomId);

    if (!room) {
      return;
    }

    // Only room owner can send audio chunks
    if (room.owner !== userId) {
      return;
    }

    // Check if broadcast is active
    if (!room.isBroadcasting) {
      return;
    }

    // Decode base64 chunk and write to FFmpeg
    try {
      const buffer = Buffer.from(data.chunk, 'base64');
      hlsBroadcastService.writeAudioChunk(roomId, buffer);
    } catch (err) {
      loggingService.logInfo(`Failed to process audio chunk for room ${roomId}`, { 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }

  /**
   * Handle request for current broadcast state
   * Returns playlist URL for HLS playback
   */
  handleRequestBroadcastState(socket: Socket): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('broadcast_state', {
        isBroadcasting: false,
        playlistUrl: null,
      });
      return;
    }

    const { roomId } = session;
    const room = this.roomService.getRoom(roomId);

    if (!room) {
      socket.emit('broadcast_state', {
        isBroadcasting: false,
        playlistUrl: null,
      });
      return;
    }

    const isBroadcasting = room.isBroadcasting ?? false;
    const playlistUrl = isBroadcasting ? hlsBroadcastService.getPlaylistUrl(roomId) : null;
    
    socket.emit('broadcast_state', {
      isBroadcasting,
      playlistUrl,
    });
  }

  /**
   * Handle user leaving - stop broadcast if room owner leaves
   */
  handleUserLeave(roomId: string, userId: string, namespace: Namespace): void {
    const room = this.roomService.getRoom(roomId);
    if (!room) return;

    // If the leaving user is the room owner and broadcast is active, stop it
    if (room.owner === userId && room.isBroadcasting) {
      hlsBroadcastService.stopBroadcast(roomId);
      this.roomService.toggleBroadcast(roomId, false);

      namespace.emit('broadcast_state_changed', {
        isBroadcasting: false,
        playlistUrl: null,
      });

      loggingService.logInfo(`HLS broadcast stopped due to owner leaving room ${roomId}`);
    }
  }
}
