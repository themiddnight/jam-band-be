import { Namespace, Socket } from 'socket.io';
import { RoomHandlers } from './RoomHandlers';
import { RoomSessionManager } from '../services/RoomSessionManager';
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService';
import { ConnectionHealthService } from '../services/ConnectionHealthService';
import { ConnectionOptimizationService } from '../services/ConnectionOptimizationService';
import { BackendErrorRecoveryService, BackendErrorType } from '../services/ErrorRecoveryService';
import { loggingService } from '../services/LoggingService';
import { secureSocketEvent } from '../middleware/security';
import { checkSocketRateLimit } from '../middleware/rateLimit';
import {
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
  updateMetronomeSchema,
  approvalRequestSchema,
  approvalResponseSchema,
  approvalCancelSchema
} from '../validation/schemas';

export class NamespaceEventHandlers {
  private performanceMonitoring: PerformanceMonitoringService | null = null;
  private connectionHealth: ConnectionHealthService | null = null;
  private connectionOptimization: ConnectionOptimizationService | null = null;
  private errorRecoveryService: BackendErrorRecoveryService;

  constructor(
    private roomHandlers: RoomHandlers,
    private roomSessionManager: RoomSessionManager
  ) {
    this.errorRecoveryService = new BackendErrorRecoveryService();
  }

  /**
   * Set performance monitoring services
   */
  setPerformanceServices(
    performanceMonitoring: PerformanceMonitoringService,
    connectionHealth: ConnectionHealthService,
    connectionOptimization: ConnectionOptimizationService
  ): void {
    this.performanceMonitoring = performanceMonitoring;
    this.connectionHealth = connectionHealth;
    this.connectionOptimization = connectionOptimization;
  }

  /**
   * Get error recovery service for external access
   */
  getErrorRecoveryService(): BackendErrorRecoveryService {
    return this.errorRecoveryService;
  }

  /**
   * Wrapper to track performance and handle errors for room events
   * Requirements: 6.10 - Comprehensive error handling for namespace connection failures
   */
  private trackRoomEvent<T>(
    roomId: string,
    eventName: string,
    handler: (socket: Socket, data: T) => void
  ): (socket: Socket, data: T) => void {
    return async (socket: Socket, data: T) => {
      const startTime = Date.now();
      
      try {
        handler(socket, data);
        
        const duration = Date.now() - startTime;
        if (this.performanceMonitoring) {
          this.performanceMonitoring.recordRoomEvent(roomId, eventName, duration);
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        
        // Record performance error
        if (this.performanceMonitoring) {
          this.performanceMonitoring.recordRoomError(roomId, error as Error, {
            eventName,
            socketId: socket.id,
            duration
          });
        }

        // Handle error through recovery service
        await this.errorRecoveryService.handleError({
          errorType: this.classifyError(error as Error, eventName),
          message: `Error in ${eventName}: ${(error as Error).message}`,
          originalError: error as Error,
          socketId: socket.id,
          roomId,
          namespace: `/room/${roomId}`,
          timestamp: Date.now(),
          additionalData: {
            eventName,
            duration,
            data: this.sanitizeEventData(data)
          }
        }, socket);

        // Don't re-throw to prevent client disconnection unless critical
        if (this.isCriticalError(error as Error)) {
          throw error;
        }
      }
    };
  }

  /**
   * Classify error type based on error and event context
   */
  private classifyError(error: Error, eventName: string): BackendErrorType {
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      return BackendErrorType.VALIDATION_ERROR;
    }
    
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many')) {
      return BackendErrorType.RATE_LIMIT_ERROR;
    }
    
    if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      return BackendErrorType.PERMISSION_ERROR;
    }
    
    if (errorMessage.includes('session') || eventName.includes('join') || eventName.includes('leave')) {
      return BackendErrorType.SESSION_MANAGEMENT_ERROR;
    }
    
    if (errorMessage.includes('room') || errorMessage.includes('state')) {
      return BackendErrorType.ROOM_STATE_ERROR;
    }
    
    if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      return BackendErrorType.NETWORK_ERROR;
    }
    
    return BackendErrorType.UNKNOWN_ERROR;
  }

  /**
   * Check if error is critical and should cause disconnection
   */
  private isCriticalError(error: Error): boolean {
    const criticalPatterns = [
      'out of memory',
      'stack overflow',
      'database connection lost',
      'server shutting down'
    ];
    
    const errorMessage = error.message.toLowerCase();
    return criticalPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Sanitize event data for logging (remove sensitive information)
   */
  private sanitizeEventData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = { ...data };
    
    // Remove potentially sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    sensitiveFields.forEach(field => {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Set up event handlers for room namespaces
   * Requirements: 7.1, 7.2, 7.3, 7.4
   */
  setupRoomNamespaceHandlers(namespace: Namespace, roomId: string): void {
    namespace.on('connection', (socket: Socket) => {
      const startTime = Date.now();
      
      loggingService.logInfo('Socket connected to room namespace', {
        socketId: socket.id,
        roomId,
        namespacePath: `/room/${roomId}`
      });

      // Check connection optimization
      if (this.connectionOptimization) {
        const connectionCheck = this.connectionOptimization.shouldAllowConnection(socket, roomId);
        if (!connectionCheck.allowed) {
          socket.emit('connection_rejected', {
            reason: connectionCheck.reason,
            queuePosition: connectionCheck.queuePosition
          });
          
          if (!connectionCheck.queuePosition) {
            socket.disconnect();
            return;
          }
        } else {
          // Register successful connection
          this.connectionOptimization.registerConnection(socket, roomId);
        }
      }

      // Register connection for health monitoring
      if (this.connectionHealth) {
        // We'll need to get userId from session after it's established
        socket.on('join_room', (data) => {
          const session = this.roomSessionManager.getRoomSession(socket.id);
          if (session) {
            this.connectionHealth!.registerConnection(socket, session.userId, roomId, `/room/${roomId}`);
          }
        });
      }

      // Bind all room-specific event handlers
      this.bindRoomEventHandlers(socket, roomId, namespace);

      socket.on('disconnect', async (reason) => {
        const disconnectTime = Date.now();
        const connectionDuration = disconnectTime - startTime;
        
        loggingService.logInfo('Socket disconnected from room namespace', {
          socketId: socket.id,
          roomId,
          reason,
          connectionDuration,
          namespacePath: `/room/${roomId}`
        });

        try {
          // Unregister from performance monitoring services
          if (this.connectionHealth) {
            this.connectionHealth.unregisterConnection(socket.id);
          }
          
          if (this.connectionOptimization) {
            this.connectionOptimization.unregisterConnection(socket, roomId);
          }

          // Handle user leaving room
          this.roomHandlers.handleLeaveRoom(socket, false);
          
          // Clean up session
          this.roomSessionManager.removeSession(socket.id);
        } catch (error) {
          // Handle cleanup errors
          await this.errorRecoveryService.handleError({
            errorType: BackendErrorType.SESSION_MANAGEMENT_ERROR,
            message: `Error during disconnect cleanup: ${(error as Error).message}`,
            originalError: error as Error,
            socketId: socket.id,
            roomId,
            namespace: `/room/${roomId}`,
            timestamp: Date.now(),
            additionalData: { disconnectReason: reason, connectionDuration }
          });
        }
      });

      socket.on('error', async (error) => {
        loggingService.logError(error, {
          context: 'Room namespace socket error',
          socketId: socket.id,
          roomId,
          namespacePath: `/room/${roomId}`
        });

        // Handle socket errors through recovery service
        await this.errorRecoveryService.handleError({
          errorType: BackendErrorType.NAMESPACE_CONNECTION_ERROR,
          message: `Socket error in room namespace: ${error.message || 'Unknown error'}`,
          originalError: error instanceof Error ? error : new Error(String(error)),
          socketId: socket.id,
          roomId,
          namespace: `/room/${roomId}`,
          timestamp: Date.now()
        }, socket);
      });
    });
  }

  /**
   * Bind all room-specific event handlers to the socket
   * Requirements: 7.1, 7.2, 7.3, 7.4
   */
  private bindRoomEventHandlers(socket: Socket, roomId: string, namespace: Namespace): void {
    // Room management events with error handling
    socket.on('join_room', (data) => {
      secureSocketEvent('join_room', joinRoomSchema, 
        this.trackRoomEvent(roomId, 'join_room', 
          (socket, data) => this.roomHandlers.handleJoinRoomNamespace(socket, data, namespace)
        )
      )(socket, data);
    });
    
    socket.on('leave_room', (data) => {
      secureSocketEvent('leave_room', undefined, 
        (socket, data) => this.roomHandlers.handleLeaveRoom(socket, data?.isIntendedLeave || false))(socket, data);
    });

    // Member management events
    socket.on('approve_member', (data) => {
      secureSocketEvent('approve_member', memberActionSchema, 
        (socket, data) => this.roomHandlers.handleApproveMemberNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('reject_member', (data) => {
      secureSocketEvent('reject_member', memberActionSchema, 
        (socket, data) => this.roomHandlers.handleRejectMemberNamespace(socket, data, namespace))(socket, data);
    });

    // Approval response events (from room owner)
    socket.on('approval_response', (data) => {
      secureSocketEvent('approval_response', approvalResponseSchema, 
        (socket, data) => this.roomHandlers.handleApprovalResponse(socket, data, namespace))(socket, data);
    });

    // Music events - Requirements: 7.1, 7.2
    socket.on('play_note', (data) => {
      console.log('🎹 Namespace received play_note event:', {
        socketId: socket.id,
        namespaceName: namespace.name,
        data: data
      });
      
      const rateLimitCheck = checkSocketRateLimit(socket, 'play_note');
      if (!rateLimitCheck.allowed) {
        console.log('🚫 Rate limit exceeded for play_note');
        socket.emit('error', { 
          message: `Rate limit exceeded for play_note. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      
      console.log('✅ Calling handlePlayNoteNamespace');
      this.roomHandlers.handlePlayNoteNamespace(socket, data, namespace);
    });
    
    socket.on('change_instrument', (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'change_instrument');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', { 
          message: `Rate limit exceeded for change_instrument. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      this.roomHandlers.handleChangeInstrumentNamespace(socket, data, namespace);
    });
    
    socket.on('stop_all_notes', (data) => {
      const rateLimitCheck = checkSocketRateLimit(socket, 'stop_all_notes');
      if (!rateLimitCheck.allowed) {
        socket.emit('error', { 
          message: `Rate limit exceeded for stop_all_notes. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      this.roomHandlers.handleStopAllNotesNamespace(socket, data, namespace);
    });
    
    socket.on('update_synth_params', (data) => {
      console.log('🎛️ Namespace received update_synth_params event:', {
        socketId: socket.id,
        namespaceName: namespace.name,
        data: data
      });
      
      const rateLimitCheck = checkSocketRateLimit(socket, 'update_synth_params');
      if (!rateLimitCheck.allowed) {
        console.log('🚫 Rate limit exceeded for update_synth_params');
        socket.emit('error', { 
          message: `Rate limit exceeded for update_synth_params. Try again in ${rateLimitCheck.retryAfter} seconds.`,
          retryAfter: rateLimitCheck.retryAfter 
        });
        return;
      }
      
      console.log('✅ Calling handleUpdateSynthParamsNamespace');
      this.roomHandlers.handleUpdateSynthParamsNamespace(socket, data, namespace);
    });
    
    socket.on('request_synth_params', () => {
      secureSocketEvent('request_synth_params', undefined, 
        () => this.roomHandlers.handleRequestSynthParamsNamespace(socket, namespace))(socket, undefined);
    });

    // Ownership events
    socket.on('transfer_ownership', (data) => {
      secureSocketEvent('transfer_ownership', transferOwnershipSchema, 
        (socket, data) => this.roomHandlers.handleTransferOwnershipNamespace(socket, data, namespace))(socket, data);
    });

    // WebRTC Voice events - Requirements: 7.3
    socket.on('voice_offer', (data) => {
      secureSocketEvent('voice_offer', voiceOfferSchema, 
        (socket, data) => this.roomHandlers.handleVoiceOfferNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('voice_answer', (data) => {
      secureSocketEvent('voice_answer', voiceAnswerSchema, 
        (socket, data) => this.roomHandlers.handleVoiceAnswerNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('voice_ice_candidate', (data) => {
      secureSocketEvent('voice_ice_candidate', voiceIceCandidateSchema, 
        (socket, data) => this.roomHandlers.handleVoiceIceCandidateNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('join_voice', (data) => {
      secureSocketEvent('join_voice', voiceJoinSchema, 
        (socket, data) => this.roomHandlers.handleJoinVoiceNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('leave_voice', (data) => {
      secureSocketEvent('leave_voice', voiceLeaveSchema, 
        (socket, data) => this.roomHandlers.handleLeaveVoiceNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('voice_mute_changed', (data) => {
      secureSocketEvent('voice_mute_changed', voiceMuteChangedSchema, 
        (socket, data) => this.roomHandlers.handleVoiceMuteChangedNamespace(socket, data, namespace))(socket, data);
    });
    
    socket.on('request_voice_participants', (data) => {
      secureSocketEvent('request_voice_participants', requestVoiceParticipantsSchema, 
        (socket, data) => this.roomHandlers.handleRequestVoiceParticipantsNamespace(socket, data, namespace))(socket, data);
    });

    // Full Mesh Network Coordination
    socket.on('request_mesh_connections', (data) => {
      this.roomHandlers.handleRequestMeshConnectionsNamespace(socket, data, namespace);
    });

    // WebRTC Health Monitoring events
    socket.on('voice_heartbeat', (data) => {
      this.roomHandlers.handleVoiceHeartbeatNamespace(socket, data, namespace);
    });

    socket.on('voice_connection_failed', (data) => {
      this.roomHandlers.handleVoiceConnectionFailedNamespace(socket, data, namespace);
    });

    // Chat events - Requirements: 7.4
    socket.on('chat_message', (data) => {
      secureSocketEvent('chat_message', chatMessageSchema, 
        (socket, data) => this.roomHandlers.handleChatMessageNamespace(socket, data, namespace))(socket, data);
    });

    // Metronome events
    socket.on('update_metronome', (data) => {
      secureSocketEvent('update_metronome', updateMetronomeSchema, 
        (socket, data) => this.roomHandlers.handleUpdateMetronomeNamespace(socket, data, namespace))(socket, data);
    });

    socket.on('request_metronome_state', () => {
      this.roomHandlers.handleRequestMetronomeStateNamespace(socket, namespace);
    });

    // Ping measurement events for latency monitoring in rooms
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
  }

  /**
   * Set up event handlers for approval namespaces
   * Requirements: 3.1, 3.2, 3.6, 3.7, 3.8
   */
  setupApprovalNamespaceHandlers(namespace: Namespace, roomId: string): void {
    namespace.on('connection', (socket: Socket) => {
      loggingService.logInfo('Socket connected to approval namespace', {
        socketId: socket.id,
        roomId,
        namespacePath: `/approval/${roomId}`
      });

      // Handle initial approval connection setup
      this.roomHandlers.handleApprovalConnection(socket, roomId, namespace);

      // Bind approval-specific event handlers
      this.bindApprovalEventHandlers(socket, roomId, namespace);

      socket.on('disconnect', (reason) => {
        loggingService.logInfo('Socket disconnected from approval namespace', {
          socketId: socket.id,
          roomId,
          reason,
          namespacePath: `/approval/${roomId}`
        });

        // Handle approval disconnect (cancellation due to disconnect)
        this.roomHandlers.handleApprovalDisconnect(socket);

        // Clean up session
        this.roomSessionManager.removeSession(socket.id);
      });

      socket.on('error', (error) => {
        loggingService.logError(error, {
          context: 'Approval namespace socket error',
          socketId: socket.id,
          roomId,
          namespacePath: `/approval/${roomId}`
        });
      });
    });
  }

  /**
   * Bind approval-specific event handlers to the socket
   * Requirements: 3.1, 3.2, 3.6, 3.7
   */
  private bindApprovalEventHandlers(socket: Socket, roomId: string, namespace: Namespace): void {
    // Handle approval request from waiting user
    socket.on('request_approval', (data) => {
      secureSocketEvent('request_approval', approvalRequestSchema, 
        (socket, data) => this.roomHandlers.handleApprovalRequest(socket, data, namespace))(socket, data);
    });

    // Handle approval cancellation from waiting user
    socket.on('cancel_approval_request', (data) => {
      secureSocketEvent('cancel_approval_request', approvalCancelSchema, 
        (socket, data) => this.roomHandlers.handleApprovalCancel(socket, data, namespace))(socket, data);
    });

    // Ping measurement events for latency monitoring during approval
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
  }

  /**
   * Set up event handlers for lobby monitor namespace
   * Requirements: 4.2
   */
  setupLobbyMonitorNamespaceHandlers(namespace: Namespace): void {
    namespace.on('connection', (socket: Socket) => {
      loggingService.logInfo('Socket connected to lobby monitor namespace', {
        socketId: socket.id,
        namespacePath: '/lobby-monitor'
      });

      // Lobby monitor event handlers
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

      socket.on('disconnect', (reason) => {
        loggingService.logInfo('Socket disconnected from lobby monitor namespace', {
          socketId: socket.id,
          reason,
          namespacePath: '/lobby-monitor'
        });

        // Clean up session
        this.roomSessionManager.removeSession(socket.id);
      });

      socket.on('error', (error) => {
        loggingService.logError(error, {
          context: 'Lobby monitor namespace socket error',
          socketId: socket.id,
          namespacePath: '/lobby-monitor'
        });
      });
    });
  }

  /**
   * Get system health status
   * Requirements: 6.10 - Connection health monitoring and automatic recovery
   */
  getSystemHealth(): {
    isHealthy: boolean;
    errorRecoveryStats: ReturnType<BackendErrorRecoveryService['getErrorStats']>;
    healthReport: ReturnType<BackendErrorRecoveryService['getHealthReport']>;
  } {
    const errorStats = this.errorRecoveryService.getErrorStats();
    const healthReport = this.errorRecoveryService.getHealthReport();
    
    return {
      isHealthy: this.errorRecoveryService.isSystemHealthy(),
      errorRecoveryStats: errorStats,
      healthReport
    };
  }

  /**
   * Clear error recovery state (for manual intervention)
   */
  clearErrorRecoveryState(): void {
    this.errorRecoveryService.clearErrorHistory();
  }
}