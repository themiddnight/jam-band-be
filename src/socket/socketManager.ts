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
  requestVoiceParticipantsSchema
} from '../validation/schemas';

export class SocketManager {
  private connectionPool = new Map<string, { lastActivity: number; eventCount: number }>();
  private readonly MAX_EVENTS_PER_MINUTE = 1000;
  private readonly CONNECTION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor(private io: Server, private roomHandlers: RoomHandlers) {
    // Clean up inactive connections every 5 minutes
    setInterval(() => this.cleanupInactiveConnections(), 5 * 60 * 1000);
    
    // Clean up stale voice connections every 2 minutes
    setInterval(() => this.roomHandlers.cleanupStaleVoiceConnections(), 2 * 60 * 1000);
  }

  private cleanupInactiveConnections(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [socketId, data] of this.connectionPool.entries()) {
      if (now - data.lastActivity > this.CONNECTION_TIMEOUT) {
        this.connectionPool.delete(socketId);
        // Force disconnect inactive socket
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          cleanedCount++;
        }
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} inactive socket connections`);
    }
  }

  private trackSocketActivity(socketId: string): void {
    const now = Date.now();
    const existing = this.connectionPool.get(socketId);
    
    if (existing) {
      existing.lastActivity = now;
      existing.eventCount++;
    } else {
      this.connectionPool.set(socketId, {
        lastActivity: now,
        eventCount: 1
      });
    }
  }

  initialize(): void {
    // Apply socket security middleware
    this.io.use(socketSecurityMiddleware);
    
    this.io.on('connection', (socket: Socket) => {
      console.log(`User connected: ${socket.id}`);
      
      // Track new connection
      this.trackSocketActivity(socket.id);
      
      // Check if this socket already has a session
      const existingSession = this.roomHandlers['roomService'].getUserSession(socket.id);
      if (existingSession) {
        console.log(`Socket ${socket.id} already has session, cleaning up`);
        this.roomHandlers['roomService'].removeUserSession(socket.id);
      }
      
      // Debug: Log all current sessions
      console.log('Current sessions:', Array.from(this.roomHandlers['roomService']['userSessions'].entries()).map(([socketId, session]) => ({
        socketId,
        roomId: session.roomId,
        userId: session.userId
      })));

      // Bind socket events with security wrapper
      this.bindSocketEvents(socket);
    });
  }

  private bindSocketEvents(socket: Socket): void {
    // Track activity for each event
    const trackEvent = (eventName: string) => {
      this.trackSocketActivity(socket.id);
    };

    // Room management events
    socket.on('create_room', (data) => {
      trackEvent('create_room');
      secureSocketEvent('create_room', createRoomSchema, 
        (socket, data) => this.roomHandlers.handleCreateRoom(socket, data))(socket, data);
    });
    
    socket.on('join_room', (data) => {
      trackEvent('join_room');
      secureSocketEvent('join_room', joinRoomSchema, 
        (socket, data) => this.roomHandlers.handleJoinRoom(socket, data))(socket, data);
    });
    
    socket.on('leave_room', (data) => {
      trackEvent('leave_room');
      secureSocketEvent('leave_room', undefined, 
        (socket, data) => this.roomHandlers.handleLeaveRoom(socket, data?.isIntendedLeave || false))(socket, data);
    });

    // Member management events
    socket.on('approve_member', (data) => {
      trackEvent('approve_member');
      secureSocketEvent('approve_member', memberActionSchema, 
        (socket, data) => this.roomHandlers.handleApproveMember(socket, data))(socket, data);
    });
    
    socket.on('reject_member', (data) => {
      trackEvent('reject_member');
      secureSocketEvent('reject_member', memberActionSchema, 
        (socket, data) => this.roomHandlers.handleRejectMember(socket, data))(socket, data);
    });

    // Music events
    socket.on('play_note', (data) => {
      trackEvent('play_note');
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
      trackEvent('change_instrument');
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
      trackEvent('update_synth_params');
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
      trackEvent('request_synth_params');
      secureSocketEvent('request_synth_params', undefined, 
        () => this.roomHandlers.handleRequestSynthParams(socket))(socket, undefined);
    });

    // Ownership events
    socket.on('transfer_ownership', (data) => {
      trackEvent('transfer_ownership');
      secureSocketEvent('transfer_ownership', transferOwnershipSchema, 
        (socket, data) => this.roomHandlers.handleTransferOwnership(socket, data))(socket, data);
    });

    // WebRTC Voice events
    socket.on('voice_offer', (data) => {
      trackEvent('voice_offer');
      secureSocketEvent('voice_offer', voiceOfferSchema, 
        (socket, data) => this.roomHandlers.handleVoiceOffer(socket, data))(socket, data);
    });
    
    socket.on('voice_answer', (data) => {
      trackEvent('voice_answer');
      secureSocketEvent('voice_answer', voiceAnswerSchema, 
        (socket, data) => this.roomHandlers.handleVoiceAnswer(socket, data))(socket, data);
    });
    
    socket.on('voice_ice_candidate', (data) => {
      trackEvent('voice_ice_candidate');
      secureSocketEvent('voice_ice_candidate', voiceIceCandidateSchema, 
        (socket, data) => this.roomHandlers.handleVoiceIceCandidate(socket, data))(socket, data);
    });
    
    socket.on('join_voice', (data) => {
      trackEvent('join_voice');
      secureSocketEvent('join_voice', voiceJoinSchema, 
        (socket, data) => this.roomHandlers.handleJoinVoice(socket, data))(socket, data);
    });
    
    socket.on('leave_voice', (data) => {
      trackEvent('leave_voice');
      secureSocketEvent('leave_voice', voiceLeaveSchema, 
        (socket, data) => this.roomHandlers.handleLeaveVoice(socket, data))(socket, data);
    });
    
    socket.on('voice_mute_changed', (data) => {
      trackEvent('voice_mute_changed');
      secureSocketEvent('voice_mute_changed', voiceMuteChangedSchema, 
        (socket, data) => this.roomHandlers.handleVoiceMuteChanged(socket, data))(socket, data);
    });
    
    socket.on('request_voice_participants', (data) => {
      trackEvent('request_voice_participants');
      secureSocketEvent('request_voice_participants', requestVoiceParticipantsSchema, 
        (socket, data) => this.roomHandlers.handleRequestVoiceParticipants(socket, data))(socket, data);
    });

    // WebRTC Health Monitoring events
    socket.on('voice_heartbeat', (data) => {
      trackEvent('voice_heartbeat');
      this.roomHandlers.handleVoiceHeartbeat(socket, data);
    });

    socket.on('voice_connection_failed', (data) => {
      trackEvent('voice_connection_failed');
      this.roomHandlers.handleVoiceConnectionFailed(socket, data);
    });

    // Chat events
    socket.on('chat_message', (data) => {
      trackEvent('chat_message');
      secureSocketEvent('chat_message', chatMessageSchema, 
        (socket, data) => this.roomHandlers.handleChatMessage(socket, data))(socket, data);
    });

    // Disconnect event
    socket.on('disconnect', () => {
      // Clean up connection tracking
      this.connectionPool.delete(socket.id);
      this.roomHandlers.handleDisconnect(socket);
    });
  }

  // Get connection pool statistics
  getConnectionStats(): { totalConnections: number; activeConnections: number } {
    const now = Date.now();
    const activeConnections = Array.from(this.connectionPool.values())
      .filter(data => now - data.lastActivity <= this.CONNECTION_TIMEOUT)
      .length;
    
    return {
      totalConnections: this.connectionPool.size,
      activeConnections
    };
  }
} 