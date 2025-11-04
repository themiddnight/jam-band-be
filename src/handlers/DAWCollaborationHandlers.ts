import { Namespace, Socket } from 'socket.io';
import { loggingService } from '../services/LoggingService';
import { RoomService } from '../services/RoomService';
import { RoomSessionManager } from '../services/RoomSessionManager';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { RealTimeChangeService } from '../services/RealTimeChangeService';
import { CollaborationPersistenceIntegrationService } from '../services/CollaborationPersistenceIntegrationService';
import { dawServerErrorHandler, DAWServerErrorType } from '../services/DAWErrorHandler';
import AudioRecordingSyncHandlers from './AudioRecordingSyncHandlers';

/**
 * DAW Operation for real-time synchronization
 */
export interface DAWOperation {
  id: string;
  type: string;
  userId: string;
  username: string;
  timestamp: Date;
  roomId: string;
  
  // Operation data
  targetId: string; // ID of the object being modified
  operation: string; // Specific operation name
  parameters: Record<string, any>;
  
  // Metadata
  projectId: string;
  version: number;
}

/**
 * User presence information
 */
export interface UserPresence {
  userId: string;
  username: string;
  isOnline: boolean;
  lastActivity: Date;
  
  // Current activity
  currentTrackId?: string;
  cursorPosition?: number;
  selection?: {
    regionIds: string[];
    startTime: number;
    endTime: number;
  };
  
  // Visual indicators
  color: string;
  isEditing: boolean;
  editingRegionId?: string;
}

/**
 * Handles DAW collaboration events for real-time synchronization
 */
export class DAWCollaborationHandlers {
  private userPresence = new Map<string, Map<string, UserPresence>>(); // roomId -> userId -> presence
  private userColors = ['#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16'];
  private colorIndex = 0;
  private audioRecordingSyncHandlers: AudioRecordingSyncHandlers;

  constructor(
    private roomService: RoomService,
    private roomSessionManager: RoomSessionManager,
    private projectStateManager: ProjectStateManager,
    private realTimeChangeService: RealTimeChangeService,
    private integrationService: CollaborationPersistenceIntegrationService
  ) {
    this.audioRecordingSyncHandlers = new AudioRecordingSyncHandlers();
  }

  /**
   * Set up DAW collaboration handlers for a room namespace
   */
  setupDAWCollaborationHandlers(namespace: Namespace, roomId: string): void {
    namespace.on('connection', (socket: Socket) => {
      this.handleUserConnection(socket, namespace, roomId);
    });

    // Set up WebRTC data channel coordination
    this.setupWebRTCDataChannelHandlers(namespace, roomId);
  }

  /**
   * Set up WebRTC data channel coordination handlers
   */
  private setupWebRTCDataChannelHandlers(namespace: Namespace, roomId: string): void {
    // Handle WebRTC peer connection establishment for DAW data channels
    namespace.on('daw:webrtc_peer_ready', (socket: Socket, data: { userId: string; peerId: string }) => {
      // Notify other users that a new peer is ready for DAW data channels
      socket.to(`daw-${roomId}`).emit('daw:webrtc_peer_available', {
        userId: data.userId,
        peerId: data.peerId,
        timestamp: new Date()
      });

      loggingService.logInfo('DAW WebRTC peer ready', {
        userId: data.userId,
        peerId: data.peerId,
        roomId
      });
    });

    // Handle WebRTC data channel status updates
    namespace.on('daw:webrtc_channel_status', (socket: Socket, data: { 
      targetUserId: string; 
      status: 'opened' | 'closed' | 'error';
      error?: string;
    }) => {
      const session = this.roomSessionManager.getRoomSession(socket.id);
      if (!session) return;

      // Notify the target user about channel status
      const targetSockets = Array.from(namespace.sockets.values())
        .filter(s => {
          const targetSession = this.roomSessionManager.getRoomSession(s.id);
          return targetSession?.userId === data.targetUserId;
        });

      targetSockets.forEach(targetSocket => {
        targetSocket.emit('daw:webrtc_channel_status_update', {
          fromUserId: session.userId,
          status: data.status,
          error: data.error,
          timestamp: new Date()
        });
      });

      loggingService.logInfo('DAW WebRTC channel status update', {
        fromUserId: session.userId,
        targetUserId: data.targetUserId,
        status: data.status,
        roomId
      });
    });

    // Handle audio file distribution coordination
    namespace.on('daw:audio_file_distribution_start', (socket: Socket, data: {
      fileId: string;
      filename: string;
      size: number;
      targetUserIds: string[];
    }) => {
      const session = this.roomSessionManager.getRoomSession(socket.id);
      if (!session) return;

      // Notify target users about incoming audio file
      data.targetUserIds.forEach(targetUserId => {
        const targetSockets = Array.from(namespace.sockets.values())
          .filter(s => {
            const targetSession = this.roomSessionManager.getRoomSession(s.id);
            return targetSession?.userId === targetUserId;
          });

        targetSockets.forEach(targetSocket => {
          targetSocket.emit('daw:audio_file_incoming', {
            fileId: data.fileId,
            filename: data.filename,
            size: data.size,
            fromUserId: session.userId,
            timestamp: new Date()
          });
        });
      });

      loggingService.logInfo('DAW audio file distribution started', {
        fileId: data.fileId,
        filename: data.filename,
        fromUserId: session.userId,
        targetCount: data.targetUserIds.length,
        roomId
      });
    });

    // Handle audio file distribution completion
    namespace.on('daw:audio_file_distribution_complete', (socket: Socket, data: {
      fileId: string;
      success: boolean;
      error?: string;
    }) => {
      const session = this.roomSessionManager.getRoomSession(socket.id);
      if (!session) return;

      // Broadcast completion status to room
      socket.to(`daw-${roomId}`).emit('daw:audio_file_sync_complete', {
        fileId: data.fileId,
        success: data.success,
        error: data.error,
        completedBy: session.userId,
        timestamp: new Date()
      });

      loggingService.logInfo('DAW audio file distribution complete', {
        fileId: data.fileId,
        success: data.success,
        userId: session.userId,
        roomId
      });
    });
  }

  /**
   * Handle user connection to DAW collaboration
   */
  private async handleUserConnection(socket: Socket, namespace: Namespace, roomId: string): Promise<void> {
    // Get user session (same pattern as other handlers)
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      loggingService.logInfo('DAW collaboration connection without session - user needs to join room first', {
        socketId: socket.id,
        roomId
      });
      return; // User hasn't joined the room yet, this is normal
    }

    // Get user data from room service
    const user = this.roomService.findUserInRoom(session.roomId, session.userId);
    if (!user) {
      const error = dawServerErrorHandler.handleError(
        DAWServerErrorType.AUTHENTICATION_ERROR,
        'User not found in room for DAW collaboration',
        { socketId: socket.id, roomId, userId: session.userId },
        'DAWCollaborationHandlers'
      );
      
      socket.emit('daw:auth_error', {
        error: 'User not found in room',
        errorId: error.id,
        timestamp: new Date()
      });
      
      return;
    }

    const userId = session.userId;
    const username = user.username;

    // Initialize user presence
    this.initializeUserPresence(roomId, userId, username);

    // Join room-specific socket room
    socket.join(`daw-${roomId}`);

    loggingService.logInfo('User connected to DAW collaboration', {
      userId,
      username,
      roomId,
      socketId: socket.id
    });

    // Initialize collaboration-persistence integration for this user
    await this.integrationService.handleUserConnection(socket, namespace, roomId, userId, username);

    // Send current project state to new user
    this.sendProjectStateToUser(socket, roomId, userId);

    // Broadcast user presence to other users
    this.broadcastUserPresence(namespace, roomId, userId);

    // Set up event handlers
    this.setupSocketEventHandlers(socket, namespace, roomId, userId, username);

    // Set up audio recording synchronization handlers
    this.audioRecordingSyncHandlers.setupHandlers(socket, roomId, userId, username);

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleUserDisconnection(namespace, roomId, userId);
    });
  }

  /**
   * Initialize user presence data
   */
  private initializeUserPresence(roomId: string, userId: string, username: string): void {
    if (!this.userPresence.has(roomId)) {
      this.userPresence.set(roomId, new Map());
    }

    const roomPresence = this.userPresence.get(roomId)!;
    const userColor = this.userColors[this.colorIndex % this.userColors.length] || '#3b82f6';
    this.colorIndex++;

    const presence: UserPresence = {
      userId,
      username,
      isOnline: true,
      lastActivity: new Date(),
      color: userColor,
      isEditing: false
    };

    roomPresence.set(userId, presence);
  }

  /**
   * Send current project state to a new user
   */
  private async sendProjectStateToUser(socket: Socket, roomId: string, userId: string): Promise<void> {
    try {
      // Get current project state from backend
      const projectState = await this.projectStateManager.getCompleteProjectState(roomId);
      
      if (projectState) {
        socket.emit('daw:project_state_sync', {
          projectState,
          timestamp: new Date()
        });

        loggingService.logInfo('Sent project state to new user', {
          userId,
          roomId,
          projectId: projectState.project?.id
        });
      } else {
        // Send empty project state for new projects
        socket.emit('daw:project_state_sync', {
          projectState: null,
          timestamp: new Date()
        });
      }
    } catch (error) {
      const dawError = dawServerErrorHandler.handleError(
        DAWServerErrorType.PROJECT_LOAD_ERROR,
        error as Error,
        { userId, roomId, context: 'sendProjectStateToUser' },
        'DAWCollaborationHandlers'
      );

      socket.emit('daw:sync_error', {
        error: 'Failed to load project state',
        errorId: dawError.id,
        timestamp: new Date()
      });
    }
  }

  /**
   * Broadcast user presence to other users in the room
   */
  private broadcastUserPresence(namespace: Namespace, roomId: string, userId: string): void {
    const roomPresence = this.userPresence.get(roomId);
    if (!roomPresence) return;

    const allPresence = Array.from(roomPresence.values());
    
    namespace.to(`daw-${roomId}`).emit('daw:user_presence_update', {
      users: allPresence,
      timestamp: new Date()
    });

    loggingService.logInfo('Broadcasted user presence update', {
      roomId,
      userCount: allPresence.length,
      activeUserId: userId
    });
  }

  /**
   * Set up socket event handlers for DAW operations
   */
  private setupSocketEventHandlers(
    socket: Socket, 
    namespace: Namespace, 
    roomId: string, 
    userId: string, 
    username: string
  ): void {
    // Handle DAW operations
    socket.on('daw:operation', async (data) => {
      await this.handleDAWOperation(socket, namespace, roomId, userId, username, data);
    });

    // Handle user cursor movement
    socket.on('daw:cursor_move', (data) => {
      this.handleCursorMove(namespace, roomId, userId, data);
    });

    // Handle user selection changes
    socket.on('daw:selection_change', (data) => {
      this.handleSelectionChange(namespace, roomId, userId, data);
    });

    // Handle user activity updates
    socket.on('daw:user_activity', (data) => {
      this.handleUserActivity(namespace, roomId, userId, data);
    });

    // Handle project state requests
    socket.on('daw:request_project_state', async () => {
      await this.sendProjectStateToUser(socket, roomId, userId);
    });

    // Handle WebRTC data channel events
    socket.on('daw:webrtc_peer_ready', (data) => {
      namespace.emit('daw:webrtc_peer_ready', socket, data);
    });

    socket.on('daw:webrtc_channel_status', (data) => {
      namespace.emit('daw:webrtc_channel_status', socket, data);
    });

    socket.on('daw:audio_file_distribution_start', (data) => {
      namespace.emit('daw:audio_file_distribution_start', socket, data);
    });

    socket.on('daw:audio_file_distribution_complete', (data) => {
      namespace.emit('daw:audio_file_distribution_complete', socket, data);
    });
  }

  /**
   * Handle DAW operations for real-time synchronization
   */
  private async handleDAWOperation(
    socket: Socket,
    namespace: Namespace,
    roomId: string,
    userId: string,
    username: string,
    operationData: any
  ): Promise<void> {
    try {
      const operation: DAWOperation = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: operationData.type,
        userId,
        username,
        timestamp: new Date(),
        roomId,
        targetId: operationData.targetId,
        operation: operationData.operation,
        parameters: operationData.parameters,
        projectId: operationData.projectId,
        version: operationData.version || 1
      };

      // Validate operation
      if (!this.validateDAWOperation(operation)) {
        const validationError = dawServerErrorHandler.handleError(
          DAWServerErrorType.VALIDATION_ERROR,
          'Invalid operation data',
          { operation: operationData, userId, roomId },
          'DAWCollaborationHandlers'
        );

        socket.emit('daw:operation_error', {
          error: 'Invalid operation data',
          errorId: validationError.id,
          operationId: operation.id,
          timestamp: new Date()
        });
        return;
      }

      // Store operation in project state manager
      await this.projectStateManager.recordChange(
        operation.projectId,
        operation.userId,
        operation.type as any,
        operation.parameters,
        operationData.previousState
      );

      // Broadcast operation to other users in the room
      socket.to(`daw-${roomId}`).emit('daw:operation_broadcast', {
        operation,
        timestamp: new Date()
      });

      // Update user activity
      this.updateUserActivity(roomId, userId, {
        isEditing: true,
        editingRegionId: operation.targetId,
        currentTrackId: operationData.trackId
      });

      // Acknowledge operation to sender
      socket.emit('daw:operation_ack', {
        operationId: operation.id,
        timestamp: new Date()
      });

      loggingService.logInfo('Processed DAW operation', {
        operationId: operation.id,
        type: operation.type,
        userId,
        roomId,
        targetId: operation.targetId
      });

    } catch (error) {
      const dawError = dawServerErrorHandler.handleError(
        DAWServerErrorType.OPERATION_SYNC_ERROR,
        error as Error,
        { 
          userId, 
          roomId, 
          operationType: operationData.type,
          operationId: operationData.id,
          context: 'handleDAWOperation'
        },
        'DAWCollaborationHandlers'
      );

      socket.emit('daw:operation_error', {
        error: 'Failed to process operation',
        errorId: dawError.id,
        operationId: operationData.id,
        timestamp: new Date()
      });
    }
  }

  /**
   * Handle user cursor movement
   */
  private handleCursorMove(namespace: Namespace, roomId: string, userId: string, data: any): void {
    this.updateUserActivity(roomId, userId, {
      cursorPosition: data.position
    });

    // Broadcast cursor position to other users
    namespace.to(`daw-${roomId}`).emit('daw:cursor_update', {
      userId,
      position: data.position,
      timestamp: new Date()
    });
  }

  /**
   * Handle user selection changes
   */
  private handleSelectionChange(namespace: Namespace, roomId: string, userId: string, data: any): void {
    this.updateUserActivity(roomId, userId, {
      selection: data.selection
    });

    // Broadcast selection to other users
    namespace.to(`daw-${roomId}`).emit('daw:selection_update', {
      userId,
      selection: data.selection,
      timestamp: new Date()
    });
  }

  /**
   * Handle user activity updates
   */
  private handleUserActivity(namespace: Namespace, roomId: string, userId: string, data: any): void {
    this.updateUserActivity(roomId, userId, {
      currentTrackId: data.trackId,
      isEditing: data.isEditing || false
    });

    // Broadcast activity update
    this.broadcastUserPresence(namespace, roomId, userId);
  }

  /**
   * Update user activity and presence
   */
  private updateUserActivity(roomId: string, userId: string, updates: Partial<UserPresence>): void {
    const roomPresence = this.userPresence.get(roomId);
    if (!roomPresence) return;

    const userPresence = roomPresence.get(userId);
    if (!userPresence) return;

    // Update presence data
    Object.assign(userPresence, updates, {
      lastActivity: new Date()
    });
  }

  /**
   * Handle user disconnection
   */
  private handleUserDisconnection(namespace: Namespace, roomId: string, userId: string): void {
    const roomPresence = this.userPresence.get(roomId);
    if (!roomPresence) return;

    const userPresence = roomPresence.get(userId);
    if (userPresence) {
      userPresence.isOnline = false;
      userPresence.isEditing = false;
      userPresence.lastActivity = new Date();
    }

    // Broadcast updated presence
    this.broadcastUserPresence(namespace, roomId, userId);

    loggingService.logInfo('User disconnected from DAW collaboration', {
      userId,
      roomId
    });

    // Clean up presence data after 5 minutes
    setTimeout(() => {
      roomPresence.delete(userId);
      if (roomPresence.size === 0) {
        this.userPresence.delete(roomId);
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Validate DAW operation data
   */
  private validateDAWOperation(operation: DAWOperation): boolean {
    return !!(
      operation.type &&
      operation.userId &&
      operation.targetId &&
      operation.operation &&
      operation.parameters &&
      operation.projectId
    );
  }

  /**
   * Get user presence for a room
   */
  getUserPresence(roomId: string): UserPresence[] {
    const roomPresence = this.userPresence.get(roomId);
    return roomPresence ? Array.from(roomPresence.values()) : [];
  }

  /**
   * Clean up resources for a room
   */
  cleanupRoom(roomId: string): void {
    this.userPresence.delete(roomId);
    loggingService.logInfo('Cleaned up DAW collaboration for room', { roomId });
  }
}