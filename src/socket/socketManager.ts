import { Server, Socket } from 'socket.io';
import { RoomHandlers } from '../handlers/RoomHandlers';
import { socketSecurityMiddleware, secureSocketEvent } from '../middleware/security';
import { checkSocketRateLimit } from '../middleware/rateLimit';
import {
  createRoomSchema,
  joinRoomSchema,
  chatMessageSchema,
  transferOwnershipSchema,
  memberActionSchema,
  voiceOfferSchema,
  voiceAnswerSchema,
  voiceIceCandidateSchema,
  voiceJoinSchema,
  voiceLeaveSchema,
  voiceMuteChangedSchema,
  requestVoiceParticipantsSchema,
  updateMetronomeSchema
} from '../validation/schemas';

export class SocketManager {
  constructor(private io: Server, private roomHandlers: RoomHandlers) {
    // Clean up stale voice connections every 2 minutes
    setInterval(() => this.roomHandlers.cleanupStaleVoiceConnections(), 2 * 60 * 1000);
  }

  initialize(): void {
    // Apply socket security middleware
    this.io.use(socketSecurityMiddleware);
    
    this.io.on('connection', (socket: Socket) => {
      console.log(`User connected: ${socket.id}`);
      
      // Check if this socket already has a session
      const existingSession = this.roomHandlers['roomSessionManager'].getSession(socket.id);
      if (existingSession) {
        console.log(`Socket ${socket.id} already has session, cleaning up`);
        this.roomHandlers['roomSessionManager'].removeSession(socket.id);
      }
      
      // Debug: Log all current sessions
      const sessionStats = this.roomHandlers['roomSessionManager'].getSessionStats();
      console.log('Current sessions:', sessionStats);

      // Bind socket events with security wrapper
      this.bindSocketEvents(socket);
    });
  }

  private bindSocketEvents(socket: Socket): void {
    // Room management events
    socket.on('create_room', (data) => {
      secureSocketEvent('create_room', createRoomSchema, 
        (socket, data) => this.roomHandlers.handleCreateRoom(socket, data))(socket, data);
    });
    
    socket.on('join_room', (data) => {
      secureSocketEvent('join_room', joinRoomSchema, 
        (socket, data) => this.roomHandlers.handleJoinRoom(socket, data))(socket, data);
    });
    
    socket.on('leave_room', (data) => {
      secureSocketEvent('leave_room', undefined, 
        (socket, data) => this.roomHandlers.handleLeaveRoom(socket, data?.isIntendedLeave || false))(socket, data);
    });

    // Member management events
    socket.on('approve_member', (data) => {
      secureSocketEvent('approve_member', memberActionSchema, 
        (socket, data) => this.roomHandlers.handleApproveMember(socket, data))(socket, data);
    });
    
    socket.on('reject_member', (data) => {
      secureSocketEvent('reject_member', memberActionSchema, 
        (socket, data) => this.roomHandlers.handleRejectMember(socket, data))(socket, data);
    });

    // Music events
    socket.on('play_note', (data) => {
      // Musical events bypass validation for performance - only rate limiting applies
      const rateLimitCheck = checkSocketRateLimit(socket, 'play_note');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', { 
          message: `Rate limit exceeded for play_note. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      this.roomHandlers.handlePlayNote(socket, data);
    });
    
    socket.on('change_instrument', (data) => {
      // Musical events bypass validation for performance - only rate limiting applies
      const rateLimitCheck = checkSocketRateLimit(socket, 'change_instrument');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', { 
          message: `Rate limit exceeded for change_instrument. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      this.roomHandlers.handleChangeInstrument(socket, data);
    });
    
    socket.on('update_synth_params', (data) => {
      // Synth events bypass validation for performance - only rate limiting applies
      const rateLimitCheck = checkSocketRateLimit(socket, 'update_synth_params');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', { 
          message: `Rate limit exceeded for update_synth_params. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      this.roomHandlers.handleUpdateSynthParams(socket, data);
    });
    
    socket.on('request_synth_params', () => {
      secureSocketEvent('request_synth_params', undefined, 
        () => this.roomHandlers.handleRequestSynthParams(socket))(socket, undefined);
    });

    // Ownership events
    socket.on('transfer_ownership', (data) => {
      secureSocketEvent('transfer_ownership', transferOwnershipSchema, 
        (socket, data) => this.roomHandlers.handleTransferOwnership(socket, data))(socket, data);
    });

    // WebRTC Voice events
    socket.on('voice_offer', (data) => {
      secureSocketEvent('voice_offer', voiceOfferSchema, 
        (socket, data) => this.roomHandlers.handleVoiceOffer(socket, data))(socket, data);
    });
    
    socket.on('voice_answer', (data) => {
      secureSocketEvent('voice_answer', voiceAnswerSchema, 
        (socket, data) => this.roomHandlers.handleVoiceAnswer(socket, data))(socket, data);
    });
    
    socket.on('voice_ice_candidate', (data) => {
      secureSocketEvent('voice_ice_candidate', voiceIceCandidateSchema, 
        (socket, data) => this.roomHandlers.handleVoiceIceCandidate(socket, data))(socket, data);
    });
    
    socket.on('join_voice', (data) => {
      secureSocketEvent('join_voice', voiceJoinSchema, 
        (socket, data) => this.roomHandlers.handleJoinVoice(socket, data))(socket, data);
    });
    
    socket.on('leave_voice', (data) => {
      secureSocketEvent('leave_voice', voiceLeaveSchema, 
        (socket, data) => this.roomHandlers.handleLeaveVoice(socket, data))(socket, data);
    });
    
    socket.on('voice_mute_changed', (data) => {
      secureSocketEvent('voice_mute_changed', voiceMuteChangedSchema, 
        (socket, data) => this.roomHandlers.handleVoiceMuteChanged(socket, data))(socket, data);
    });
    
    socket.on('request_voice_participants', (data) => {
      secureSocketEvent('request_voice_participants', requestVoiceParticipantsSchema, 
        (socket, data) => this.roomHandlers.handleRequestVoiceParticipants(socket, data))(socket, data);
    });

    // Full Mesh Network Coordination
    socket.on('request_mesh_connections', (data) => {
      // Allow requests for mesh connection coordination without strict validation for flexibility
      this.roomHandlers.handleRequestMeshConnections(socket, data);
    });

    // WebRTC Health Monitoring events
    socket.on('voice_heartbeat', (data) => {
      this.roomHandlers.handleVoiceHeartbeat(socket, data);
    });

    socket.on('voice_connection_failed', (data) => {
      this.roomHandlers.handleVoiceConnectionFailed(socket, data);
    });

    // Chat events
    socket.on('chat_message', (data) => {
      secureSocketEvent('chat_message', chatMessageSchema, 
        (socket, data) => this.roomHandlers.handleChatMessage(socket, data))(socket, data);
    });

    // Metronome events
    socket.on('update_metronome', (data) => {
      secureSocketEvent('update_metronome', updateMetronomeSchema, 
        (socket, data) => this.roomHandlers.handleUpdateMetronome(socket, data))(socket, data);
    });

    socket.on('request_metronome_state', () => {
      this.roomHandlers.handleRequestMetronomeState(socket);
    });

    // Ping measurement for latency monitoring
    socket.on('ping_measurement', (data) => {
      // Simple ping-pong response for latency measurement
      if (data && data.pingId && data.timestamp) {
        socket.emit('ping_response', {
          pingId: data.pingId,
          timestamp: data.timestamp,
          serverTimestamp: Date.now()
        });
      }
    });

    // Disconnect event
    socket.on('disconnect', () => {
      this.roomHandlers.handleDisconnect(socket);
    });
  }
} 