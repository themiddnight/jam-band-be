import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import {
  VoiceOfferData,
  VoiceAnswerData,
  VoiceIceCandidateData,
  JoinVoiceData,
  LeaveVoiceData,
  VoiceParticipantInfo,
  VoiceMuteChangedData,
  RequestVoiceParticipantsData
} from '../../../../types';

/**
 * VoiceConnectionHandler - Handles WebRTC mesh functionality for voice communication
 * 
 * This handler manages:
 * - WebRTC offer/answer/ICE candidate exchange
 * - Voice participant management
 * - Mesh network coordination
 * - Both regular socket and namespace-based communication
 * 
 * Requirements: 4.1, 4.6
 */
export class VoiceConnectionHandler {
  private voiceParticipants = new Map<string, Map<string, VoiceParticipantInfo>>(); // roomId -> userId -> info

  constructor(
    private roomService: RoomService,
    private io: Server,
    private roomSessionManager: RoomSessionManager
  ) {}

  private getVoiceRoomMap(roomId: string): Map<string, VoiceParticipantInfo> {
    if (!this.voiceParticipants.has(roomId)) {
      this.voiceParticipants.set(roomId, new Map());
    }
    return this.voiceParticipants.get(roomId)!;
  }

  // WebRTC Voice Communication Handlers - Full Mesh Network Support
  handleVoiceOffer(socket: Socket, data: VoiceOfferData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid offer: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    const user = this.roomService.findUserInRoom(session.roomId, session.userId);
    const username = user?.username || 'Unknown';

    console.log(`[MESH] Offer from ${session.userId} to ${data.targetUserId} in room ${data.roomId}`);

    // In a full mesh network, forward the offer directly to the specific target user
    // Find the target user's socket
    const targetSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, data.targetUserId);
    if (targetSocketId) {
      const targetSocket = this.io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('voice_offer', {
          offer: data.offer,
          fromUserId: session.userId,
          fromUsername: username,
          roomId: data.roomId
        });
        console.log(`[MESH] Direct offer forwarded: ${session.userId} -> ${data.targetUserId}`);
      } else {
        console.warn(`[MESH] Target socket not found: ${data.targetUserId}`);
      }
    } else {
      // Fallback to room broadcast if direct delivery fails
      socket.to(data.roomId).emit('voice_offer', {
        offer: data.offer,
        fromUserId: session.userId,
        fromUsername: username,
        targetUserId: data.targetUserId,
        roomId: data.roomId
      });
      console.log(`[MESH] Fallback room broadcast offer: ${session.userId} -> ${data.targetUserId}`);
    }
  }

  handleVoiceAnswer(socket: Socket, data: VoiceAnswerData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid answer: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    console.log(`[MESH] Answer from ${session.userId} to ${data.targetUserId} in room ${data.roomId}`);

    // Direct delivery to specific target user for mesh networking
    const targetSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, data.targetUserId);
    if (targetSocketId) {
      const targetSocket = this.io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('voice_answer', {
          answer: data.answer,
          fromUserId: session.userId,
          roomId: data.roomId
        });
        console.log(`[MESH] Direct answer forwarded: ${session.userId} -> ${data.targetUserId}`);
      } else {
        console.warn(`[MESH] Target socket not found for answer: ${data.targetUserId}`);
      }
    } else {
      // Fallback to room broadcast
      socket.to(data.roomId).emit('voice_answer', {
        answer: data.answer,
        fromUserId: session.userId,
        targetUserId: data.targetUserId,
        roomId: data.roomId
      });
      console.log(`[MESH] Fallback room broadcast answer: ${session.userId} -> ${data.targetUserId}`);
    }
  }

  handleVoiceIceCandidate(socket: Socket, data: VoiceIceCandidateData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Direct ICE candidate delivery for mesh networking efficiency
    const targetSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, data.targetUserId);
    if (targetSocketId) {
      const targetSocket = this.io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('voice_ice_candidate', {
          candidate: data.candidate,
          fromUserId: session.userId,
          roomId: data.roomId
        });
      }
    } else {
      // Fallback to room broadcast
      socket.to(data.roomId).emit('voice_ice_candidate', {
        candidate: data.candidate,
        fromUserId: session.userId,
        targetUserId: data.targetUserId,
        roomId: data.roomId
      });
    }
  }

  handleJoinVoice(socket: Socket, data: JoinVoiceData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid join voice: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    console.log(`[MESH] User ${data.username} (${data.userId}) joined voice in room ${data.roomId}`);

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const existingParticipants = Array.from(voiceRoomMap.values());

    // Add new user to voice participants
    voiceRoomMap.set(data.userId, {
      userId: data.userId,
      username: data.username,
      isMuted: false,
      lastHeartbeat: Date.now()
    });

    // Notify other users in the room about the new voice participant
    socket.to(data.roomId).emit('user_joined_voice', {
      userId: data.userId,
      username: data.username
    });

    // For full mesh networking: Immediately send the complete participant list
    // to the new user so they can establish connections with all existing users
    socket.emit('voice_participants', {
      participants: Array.from(voiceRoomMap.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    // Also notify all existing participants about the updated participant list
    // This ensures everyone has the complete mesh network information
    socket.to(data.roomId).emit('voice_participants', {
      participants: Array.from(voiceRoomMap.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    console.log(`[MESH] Voice participant added to room ${data.roomId}. Total participants: ${voiceRoomMap.size}`);
    console.log(`[MESH] Existing participants notified:`, existingParticipants.map(p => `${p.username}(${p.userId})`));
  }

  // Mesh connection coordination - ensures proper full mesh establishment
  handleRequestMeshConnections(socket: Socket, data: { roomId: string; userId: string }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[MESH] Invalid mesh request: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const allParticipants = Array.from(voiceRoomMap.entries());
     const otherParticipants = allParticipants.filter(([ _socketId, p]) => p.userId !== data.userId);

    console.log(`[MESH] Connection request from ${data.userId}. Other participants:`,
      otherParticipants.map(([ _socketId, p]) => p.userId));

    // For full mesh: respond with all other participants this user should connect to
    socket.emit('mesh_participants', {
      participants: otherParticipants.map(([ _socketId, p]) => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        // Deterministic connection initiation based on lexicographical comparison
        shouldInitiate: data.userId.localeCompare(p.userId) < 0
      }))
    });

    // Notify each existing participant about the new user they should connect to
      otherParticipants.forEach(([ _socketId, participant]) => {
      const participantSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, participant.userId);
      if (participantSocketId) {
        const participantSocket = this.io.sockets.sockets.get(participantSocketId);
        if (participantSocket) {
          participantSocket.emit('new_mesh_peer', {
            userId: data.userId,
            username: voiceRoomMap.get(data.userId)?.username || 'Unknown',
            shouldInitiate: participant.userId.localeCompare(data.userId) < 0
          });
        }
      }
    });
  }

  handleLeaveVoice(socket: Socket, data: LeaveVoiceData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.warn(`[VOICE] Invalid leave voice: socket ${socket.id} has no session`);
      return;
    }

    console.log(`[MESH] User ${session.userId} left voice in room ${data.roomId}`);
    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    voiceRoomMap.delete(data.userId);

    // Notify other users that this user left voice chat
    socket.to(data.roomId).emit('user_left_voice', {
      userId: data.userId
    });

    // Update participant list for remaining users
    socket.to(data.roomId).emit('voice_participants', {
      participants: Array.from(voiceRoomMap.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    console.log(`[MESH] Voice participant removed from room ${data.roomId}. Remaining participants: ${voiceRoomMap.size}`);
  }

  // Namespace versions of voice handlers
  /**
   * Handle voice offer through namespace - Requirements: 7.3
   */
  handleVoiceOfferNamespace(socket: Socket, data: VoiceOfferData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid offer: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    const user = this.roomService.findUserInRoom(session.roomId, session.userId);
    const username = user?.username || 'Unknown';

    console.log(`[MESH] Offer from ${session.userId} to ${data.targetUserId} in room ${data.roomId}`);

    // Find target user in room namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    for (const [socketId, targetSession] of Array.from(roomSessions.entries())) {
      if (targetSession.userId === data.targetUserId) {
        const targetSocket = namespace.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('voice_offer', {
            offer: data.offer,
            fromUserId: session.userId,
            fromUsername: username,
            roomId: data.roomId
          });
          console.log(`[MESH] Direct offer forwarded: ${session.userId} -> ${data.targetUserId}`);
          return;
        }
      }
    }

    // Fallback to namespace broadcast
    socket.to(namespace.name).emit('voice_offer', {
      offer: data.offer,
      fromUserId: session.userId,
      fromUsername: username,
      targetUserId: data.targetUserId,
      roomId: data.roomId
    });
    console.log(`[MESH] Fallback namespace broadcast offer: ${session.userId} -> ${data.targetUserId}`);
  }

  /**
   * Handle voice answer through namespace - Requirements: 7.3
   */
  handleVoiceAnswerNamespace(socket: Socket, data: VoiceAnswerData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid answer: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    console.log(`[MESH] Answer from ${session.userId} to ${data.targetUserId} in room ${data.roomId}`);

    // Find target user in room namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    for (const [socketId, targetSession] of Array.from(roomSessions.entries())) {
      if (targetSession.userId === data.targetUserId) {
        const targetSocket = namespace.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('voice_answer', {
            answer: data.answer,
            fromUserId: session.userId,
            roomId: data.roomId
          });
          console.log(`[MESH] Direct answer forwarded: ${session.userId} -> ${data.targetUserId}`);
          return;
        }
      }
    }

    // Fallback to namespace broadcast
    socket.to(namespace.name).emit('voice_answer', {
      answer: data.answer,
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId
    });
    console.log(`[MESH] Fallback namespace broadcast answer: ${session.userId} -> ${data.targetUserId}`);
  }

  /**
   * Handle voice ICE candidate through namespace - Requirements: 7.3
   */
  handleVoiceIceCandidateNamespace(socket: Socket, data: VoiceIceCandidateData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) return;

    // Find target user in room namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    for (const [socketId, targetSession] of Array.from(roomSessions.entries())) {
      if (targetSession.userId === data.targetUserId) {
        const targetSocket = namespace.sockets.get(socketId);
        if (targetSocket) {
          targetSocket.emit('voice_ice_candidate', {
            candidate: data.candidate,
            fromUserId: session.userId,
            roomId: data.roomId
          });
          return;
        }
      }
    }

    // Fallback to namespace broadcast
    socket.to(namespace.name).emit('voice_ice_candidate', {
      candidate: data.candidate,
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId
    });
  }

  /**
   * Handle join voice through namespace with auto-connection support
   * Requirements: 7.3, 5.1, 5.2, 5.3
   */
  handleJoinVoiceNamespace(socket: Socket, data: JoinVoiceData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid join voice: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    console.log(`[MESH] User ${data.username} (${data.userId}) joined voice in room ${data.roomId}`);

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const existingParticipants = Array.from(voiceRoomMap.values());

    // Add new user to voice participants with default soft-mute - Requirement 5.3
    voiceRoomMap.set(data.userId, {
      userId: data.userId,
      username: data.username,
      isMuted: true, // Default soft-mute state for auto-connection
      lastHeartbeat: Date.now()
    });

    // Notify other users in namespace about the new voice participant
    // This triggers auto-connection for existing users - Requirement 5.2
    socket.to(namespace.name).emit('user_joined_voice', {
      userId: data.userId,
      username: data.username
    });

    // Send existing participants to new user for auto-connection - Requirement 5.1
    socket.emit('voice_participants', {
      participants: existingParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    // Notify all existing participants about updated participant list
    socket.to(namespace.name).emit('voice_participants', {
      participants: Array.from(voiceRoomMap.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    console.log(`[MESH] Voice participant added to room ${data.roomId}. Total participants: ${voiceRoomMap.size}`);
    console.log(`[MESH] Auto-connection triggered for ${existingParticipants.length} existing participants`);
  }

  /**
   * Handle leave voice through namespace - Requirements: 7.3
   */
  handleLeaveVoiceNamespace(socket: Socket, data: LeaveVoiceData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.warn(`[VOICE] Invalid leave voice: socket ${socket.id} has no session`);
      return;
    }

    console.log(`[MESH] User ${session.userId} left voice in room ${data.roomId}`);
    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    voiceRoomMap.delete(data.userId);

    // Notify other users in namespace that this user left voice chat
    socket.to(namespace.name).emit('user_left_voice', {
      userId: data.userId
    });

    // Update participant list for remaining users
    socket.to(namespace.name).emit('voice_participants', {
      participants: Array.from(voiceRoomMap.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    console.log(`[MESH] Voice participant removed from room ${data.roomId}. Remaining participants: ${voiceRoomMap.size}`);
  }

  /**
   * Handle voice mute changed through namespace - Requirements: 7.3
   */
  handleVoiceMuteChangedNamespace(socket: Socket, data: VoiceMuteChangedData, namespace: Namespace): void {
    if (!socket || !data?.roomId || !data?.userId) return;

    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) return;

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const participant = voiceRoomMap.get(data.userId);
    if (participant) {
      participant.isMuted = data.isMuted;
      participant.lastHeartbeat = Date.now();

      // Notify other users in namespace about mute state change
      socket.to(namespace.name).emit('voice_mute_changed', {
        userId: data.userId,
        isMuted: data.isMuted
      });

      console.log(`[MESH] User ${data.userId} mute state changed to ${data.isMuted} in room ${data.roomId}`);
    }
  }

  /**
   * Clean up voice participants when a room is closed
   */
  cleanupRoom(roomId: string): void {
    this.voiceParticipants.delete(roomId);
    console.log(`[VOICE] Cleaned up voice participants for room ${roomId}`);
  }

  /**
   * Handle voice mute changed (regular socket version)
   */
  handleVoiceMuteChanged(socket: Socket, data: VoiceMuteChangedData): void {
    if (!socket || !data?.roomId || !data?.userId) return;
    
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) return;

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const participant = voiceRoomMap.get(data.userId);
    if (participant) {
      participant.isMuted = data.isMuted;
      participant.lastHeartbeat = Date.now();

      // Notify other users about mute state change
      socket.to(data.roomId).emit('voice_mute_changed', {
        userId: data.userId,
        isMuted: data.isMuted
      });

      console.log(`[MESH] User ${data.userId} mute state changed to ${data.isMuted} in room ${data.roomId}`);
    }
  }

  /**
   * Handle request for voice participants
   */
  handleRequestVoiceParticipants(socket: Socket, _data: { roomId?: string }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.log(`Socket ${socket.id} not in any room`);
      return;
    }

    const roomId = session.roomId;
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    const participants = Array.from(voiceRoomMap.values());

    socket.emit('voice_participants', { participants });
  }

  /**
   * Handle voice heartbeat for connection health monitoring
   */
  handleVoiceHeartbeat(socket: Socket, data: { roomId: string; userId: string; connectionStates: Record<string, { connectionState: string; iceConnectionState: string }> }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.log(`Invalid heartbeat from socket ${socket.id}`);
      return;
    }

    const roomId = data.roomId;
    const userId = data.userId;

    console.log(`[VOICE HEARTBEAT] Received from ${userId} in room ${roomId}:`, data.connectionStates);

    // Update last seen timestamp for this user
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    const participant = voiceRoomMap.get(userId);
    if (participant) {
      participant.lastHeartbeat = Date.now();
      (participant as any).connectionStates = data.connectionStates;
    }

    // Check for failed connections and notify other participants
    const failedConnections = Object.entries(data.connectionStates)
      .filter(([ _peerId, state]) => 
        state.connectionState === 'failed' || 
        state.iceConnectionState === 'failed' ||
        state.iceConnectionState === 'disconnected'
      )
      .map(([peerId]) => peerId);

    if (failedConnections.length > 0) {
      console.log(`[VOICE HEARTBEAT] Failed connections detected for ${userId}:`, failedConnections);
      
      // Notify affected peers about connection issues
      failedConnections.forEach(failedPeerId => {
        const peerSocketId = this.roomSessionManager.findSocketByUserId(roomId, failedPeerId);
        if (peerSocketId) {
          const peerSocket = this.io.sockets.sockets.get(peerSocketId);
          if (peerSocket) {
            peerSocket.emit('voice_connection_failed', {
              fromUserId: userId,
              reason: 'peer_reported_failure'
            });
          }
        }
      });
    }
  }

  /**
   * Handle voice connection failed
   */
  handleVoiceConnectionFailed(socket: Socket, data: { roomId: string; targetUserId: string }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.log(`Invalid connection failed report from socket ${socket.id}`);
      return;
    }

    console.log(`[VOICE RECOVERY] Connection recovery requested: ${session.userId} -> ${data.targetUserId}`);

    // Notify both users to attempt reconnection
    socket.to(data.roomId).emit('voice_reconnection_requested', {
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId,
    });
  }

  /**
   * Periodic cleanup of stale voice connections
   */
  cleanupStaleVoiceConnections(): void {
    const now = Date.now();
    const STALE_THRESHOLD = 60000; // 60 seconds

    this.voiceParticipants.forEach((roomMap, roomId) => {
      const staleParticipants: string[] = [];
      
      roomMap.forEach((participant, userId) => {
        if (participant.lastHeartbeat && now - participant.lastHeartbeat > STALE_THRESHOLD) {
          staleParticipants.push(userId);
        }
      });

      // Remove stale participants
      staleParticipants.forEach(userId => {
        console.log(`[VOICE CLEANUP] Removing stale participant ${userId} from room ${roomId}`);
        roomMap.delete(userId);
      });

      // Clean up empty room maps
      if (roomMap.size === 0) {
        this.voiceParticipants.delete(roomId);
      }
    });
  }

  /**
   * Handle request voice participants through namespace
   */
  handleRequestVoiceParticipantsNamespace(socket: Socket, _data: RequestVoiceParticipantsData, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.log(`Socket ${socket.id} not in any room`);
      return;
    }

    const roomId = session.roomId;
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    const participants = Array.from(voiceRoomMap.values());

    socket.emit('voice_participants', { participants });
  }

  /**
   * Handle request mesh connections through namespace
   */
  handleRequestMeshConnectionsNamespace(socket: Socket, data: { roomId: string; userId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[MESH] Invalid mesh request: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const allParticipants = Array.from(voiceRoomMap.values());
    const otherParticipants = allParticipants.filter(p => p.userId !== data.userId);

    console.log(`[MESH] Connection request from ${data.userId}. Other participants:`,
      otherParticipants.map(p => p.userId));

    // For full mesh: respond with all other participants this user should connect to
    socket.emit('mesh_participants', {
      participants: otherParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        // Deterministic connection initiation based on lexicographical comparison
        shouldInitiate: data.userId.localeCompare(p.userId) < 0
      }))
    });

    // Notify each existing participant about the new user they should connect to
    otherParticipants.forEach(participant => {
      // Find the socket in the namespace for this participant
      for (const [socketId, socket] of Array.from(namespace.sockets)) {
        const participantSession = this.roomSessionManager.getRoomSession(socketId);
        if (participantSession && participantSession.userId === participant.userId) {
          socket.emit('new_mesh_peer', {
            userId: data.userId,
            username: voiceRoomMap.get(data.userId)?.username || 'Unknown',
            shouldInitiate: participant.userId.localeCompare(data.userId) < 0
          });
          break;
        }
      }
    });
  }

  /**
   * Handle voice heartbeat through namespace
   */
  handleVoiceHeartbeatNamespace(socket: Socket, data: { roomId: string; userId: string; connectionStates: Record<string, { connectionState: string; iceConnectionState: string }> }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.log(`Invalid heartbeat from socket ${socket.id}`);
      return;
    }

    const roomId = data.roomId;
    const userId = data.userId;

    console.log(`[VOICE HEARTBEAT] Received from ${userId} in room ${roomId}:`, data.connectionStates);

    // Update last seen timestamp for this user
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    const participant = voiceRoomMap.get(userId);
    if (participant) {
      participant.lastHeartbeat = Date.now();
      (participant as any).connectionStates = data.connectionStates;
    }

    // Check for failed connections and notify other participants through namespace
    const failedConnections = Object.entries(data.connectionStates)
      .filter(([ _peerId, state]) => 
        state.connectionState === 'failed' || 
        state.iceConnectionState === 'failed' ||
        state.iceConnectionState === 'disconnected'
      )
      .map(([peerId]) => peerId);

    if (failedConnections.length > 0) {
      console.log(`[VOICE HEARTBEAT] Failed connections detected for ${userId}:`, failedConnections);
      
      // Notify affected peers about connection issues through namespace
      failedConnections.forEach(failedPeerId => {
        // Find the socket in the namespace for this peer
        for (const [socketId, peerSocket] of Array.from(namespace.sockets)) {
          const peerSession = this.roomSessionManager.getRoomSession(socketId);
          if (peerSession && peerSession.userId === failedPeerId) {
            peerSocket.emit('voice_connection_failed', {
              fromUserId: userId,
              reason: 'peer_reported_failure'
            });
            break;
          }
        }
      });
    }
  }

  /**
   * Handle voice connection failed through namespace
   */
  handleVoiceConnectionFailedNamespace(socket: Socket, data: { roomId: string; targetUserId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.log(`Invalid connection failed report from socket ${socket.id}`);
      return;
    }

    console.log(`[VOICE RECOVERY] Connection recovery requested: ${session.userId} -> ${data.targetUserId}`);

    // Notify both users to attempt reconnection through namespace
    socket.to(namespace.name).emit('voice_reconnection_requested', {
      fromUserId: session.userId,
      targetUserId: data.targetUserId,
      roomId: data.roomId,
    });
  }

  /**
   * Get voice participants for a room (for debugging/monitoring)
   */
  getVoiceParticipants(roomId: string): VoiceParticipantInfo[] {
    const voiceRoomMap = this.getVoiceRoomMap(roomId);
    return Array.from(voiceRoomMap.values());
  }
}