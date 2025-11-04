import { EventEmitter } from 'events';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ProjectChangeRecord,
  ProjectChangeType,
  CompleteProjectState,
} from '../types/daw';
import { RealTimeChangeService } from './RealTimeChangeService';
import { ProjectStateManager } from './ProjectStateManager';
import { loggingService } from './LoggingService';

/**
 * Change streaming service for real-time collaboration
 * Handles WebSocket-based change broadcasting and synchronization
 */
export class ChangeStreamingService extends EventEmitter {
  private static instance: ChangeStreamingService;
  private io: SocketIOServer | null = null;
  private realTimeChangeService: RealTimeChangeService;
  private projectStateManager: ProjectStateManager;
  
  // Connection management
  private roomConnections = new Map<string, Set<string>>(); // roomId -> Set<socketId>
  private userSockets = new Map<string, string>(); // userId -> socketId
  private socketUsers = new Map<string, string>(); // socketId -> userId
  
  // Change streaming
  private changeStreams = new Map<string, ChangeStream>(); // projectId -> ChangeStream
  private readonly STREAM_BUFFER_SIZE = 50;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  private constructor() {
    super();
    this.realTimeChangeService = RealTimeChangeService.getInstance();
    this.projectStateManager = ProjectStateManager.getInstance();
    
    this.setupEventListeners();
  }

  static getInstance(): ChangeStreamingService {
    if (!ChangeStreamingService.instance) {
      ChangeStreamingService.instance = new ChangeStreamingService();
    }
    return ChangeStreamingService.instance;
  }

  /**
   * Initialize with Socket.IO server
   */
  initialize(io: SocketIOServer): void {
    this.io = io;
    this.setupSocketHandlers();
    this.startHeartbeat();
    
    loggingService.logInfo('ChangeStreamingService initialized');
  }

  // ============================================================================
  // Socket.IO Handlers
  // ============================================================================

  private setupSocketHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      loggingService.logInfo('Client connected to change streaming', { socketId: socket.id });

      // Handle user authentication
      socket.on('authenticate', async (data: { userId: string, roomId: string }) => {
        try {
          await this.handleUserAuthentication(socket, data.userId, data.roomId);
        } catch (error) {
          loggingService.logError(
            error instanceof Error ? error : new Error('Authentication failed'),
            { socketId: socket.id, userId: data.userId }
          );
          socket.emit('auth_error', { error: 'Authentication failed' });
        }
      });

      // Handle project changes
      socket.on('project_change', async (data: ProjectChangeData) => {
        try {
          await this.handleProjectChange(socket, data);
        } catch (error) {
          loggingService.logError(
            error instanceof Error ? error : new Error('Failed to handle project change'),
            { socketId: socket.id, changeType: data.changeType }
          );
          socket.emit('change_error', { error: 'Failed to process change' });
        }
      });

      // Handle change acknowledgment
      socket.on('change_ack', (data: { changeId: string }) => {
        this.handleChangeAcknowledgment(socket, data.changeId);
      });

      // Handle state sync request
      socket.on('request_state_sync', async (data: { projectId: string }) => {
        try {
          await this.handleStateSyncRequest(socket, data.projectId);
        } catch (error) {
          loggingService.logError(
            error instanceof Error ? error : new Error('Failed to sync state'),
            { socketId: socket.id, projectId: data.projectId }
          );
          socket.emit('sync_error', { error: 'Failed to sync state' });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleUserDisconnection(socket);
      });
    });
  }

  /**
   * Handle user authentication and room joining
   */
  private async handleUserAuthentication(socket: Socket, userId: string, roomId: string): Promise<void> {
    // Store user-socket mapping
    this.userSockets.set(userId, socket.id);
    this.socketUsers.set(socket.id, userId);

    // Add to room connections
    if (!this.roomConnections.has(roomId)) {
      this.roomConnections.set(roomId, new Set());
    }
    this.roomConnections.get(roomId)!.add(socket.id);

    // Join socket room
    socket.join(roomId);

    // Send authentication success
    socket.emit('authenticated', { userId, roomId });

    // Get projects for the room and set up change streams
    const projects = await this.projectStateManager.getProjectsByRoom(roomId);
    for (const project of projects) {
      await this.setupChangeStream(project.id);
      socket.join(`project:${project.id}`);
    }

    loggingService.logInfo('User authenticated and joined room', { userId, roomId, socketId: socket.id });
  }

  /**
   * Handle incoming project changes
   */
  private async handleProjectChange(socket: Socket, data: ProjectChangeData): Promise<void> {
    const userId = this.socketUsers.get(socket.id);
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Validate change data
    this.validateChangeData(data);

    // Queue change for persistence
    await this.realTimeChangeService.queueChange(
      data.projectId,
      userId,
      data.changeType,
      data.data,
      data.previousData
    );

    // Broadcast change to other users in the project
    this.broadcastChange(data.projectId, {
      ...data,
      userId,
      timestamp: new Date(),
      changeId: this.generateChangeId(),
    }, socket.id);

    // Send acknowledgment to sender
    socket.emit('change_accepted', {
      changeId: data.changeId,
      timestamp: new Date(),
    });
  }

  /**
   * Handle change acknowledgment from clients
   */
  private handleChangeAcknowledgment(socket: Socket, changeId: string): void {
    // Update delivery status for the change
    this.emit('change_acknowledged', {
      socketId: socket.id,
      changeId,
      timestamp: new Date(),
    });
  }

  /**
   * Handle state synchronization request
   */
  private async handleStateSyncRequest(socket: Socket, projectId: string): Promise<void> {
    const completeState = await this.projectStateManager.getCompleteProjectState(projectId);
    if (!completeState) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Send complete state to requesting client
    socket.emit('state_sync', {
      projectId,
      state: completeState,
      timestamp: new Date(),
    });

    loggingService.logInfo('State sync sent to client', { socketId: socket.id, projectId });
  }

  /**
   * Handle user disconnection
   */
  private handleUserDisconnection(socket: Socket): void {
    const userId = this.socketUsers.get(socket.id);
    
    if (userId) {
      // Remove from mappings
      this.userSockets.delete(userId);
      this.socketUsers.delete(socket.id);

      // Remove from room connections
      for (const [roomId, sockets] of this.roomConnections.entries()) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            this.roomConnections.delete(roomId);
          }
        }
      }

      loggingService.logInfo('User disconnected from change streaming', { userId, socketId: socket.id });
    }
  }

  // ============================================================================
  // Change Broadcasting
  // ============================================================================

  /**
   * Broadcast change to all users in a project
   */
  private broadcastChange(projectId: string, change: BroadcastChange, excludeSocketId?: string): void {
    if (!this.io) return;

    const roomName = `project:${projectId}`;
    
    if (excludeSocketId) {
      // Broadcast to all except sender
      this.io.to(roomName).except(excludeSocketId).emit('project_change_broadcast', change);
    } else {
      // Broadcast to all
      this.io.to(roomName).emit('project_change_broadcast', change);
    }

    // Add to change stream buffer
    this.addToChangeStream(projectId, change);

    loggingService.logInfo('Change broadcasted', {
      projectId,
      changeType: change.changeType,
      excludeSocketId,
    });
  }

  /**
   * Setup change stream for a project
   */
  private async setupChangeStream(projectId: string): Promise<void> {
    if (this.changeStreams.has(projectId)) return;

    const stream: ChangeStream = {
      projectId,
      buffer: [],
      lastSequence: 0,
      createdAt: new Date(),
    };

    this.changeStreams.set(projectId, stream);

    loggingService.logInfo('Change stream created', { projectId });
  }

  /**
   * Add change to stream buffer
   */
  private addToChangeStream(projectId: string, change: BroadcastChange): void {
    const stream = this.changeStreams.get(projectId);
    if (!stream) return;

    // Add to buffer
    stream.buffer.push({
      ...change,
      sequence: ++stream.lastSequence,
    });

    // Limit buffer size
    if (stream.buffer.length > this.STREAM_BUFFER_SIZE) {
      stream.buffer.shift();
    }
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  private setupEventListeners(): void {
    // Listen to real-time change service events
    this.realTimeChangeService.on('change_queued', (event) => {
      // Change is already broadcasted when received, no need to broadcast again
    });

    this.realTimeChangeService.on('changes_persisted', (event) => {
      // Notify all users that changes have been persisted
      this.broadcastSystemMessage(event.projectId, {
        type: 'changes_persisted',
        data: {
          changeCount: event.changeCount,
          timestamp: event.timestamp,
        },
      });
    });

    // Listen to project state manager events
    this.projectStateManager.on('project_created', (event) => {
      this.setupChangeStream(event.projectId);
    });

    this.projectStateManager.on('project_deleted', (event) => {
      this.cleanupChangeStream(event.projectId);
    });
  }

  // ============================================================================
  // System Messages
  // ============================================================================

  /**
   * Broadcast system message to all users in a project
   */
  private broadcastSystemMessage(projectId: string, message: SystemMessage): void {
    if (!this.io) return;

    this.io.to(`project:${projectId}`).emit('system_message', message);
  }

  /**
   * Send system message to specific user
   */
  sendUserMessage(userId: string, message: SystemMessage): void {
    if (!this.io) return;

    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.io.to(socketId).emit('system_message', message);
    }
  }

  // ============================================================================
  // Heartbeat and Health
  // ============================================================================

  private startHeartbeat(): void {
    setInterval(() => {
      if (this.io) {
        this.io.emit('heartbeat', { timestamp: new Date() });
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): ConnectionStats {
    const totalConnections = Array.from(this.roomConnections.values())
      .reduce((sum, sockets) => sum + sockets.size, 0);

    return {
      totalConnections,
      activeRooms: this.roomConnections.size,
      activeStreams: this.changeStreams.size,
      authenticatedUsers: this.userSockets.size,
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private validateChangeData(data: ProjectChangeData): void {
    if (!data.projectId || !data.changeType || !data.data) {
      throw new Error('Invalid change data');
    }

    // Add more specific validation based on change type
    switch (data.changeType) {
      case 'track_create':
      case 'track_update':
      case 'track_delete':
        if (!data.data.trackId && !data.data.track) {
          throw new Error('Track ID or track data required');
        }
        break;
      
      case 'region_create':
      case 'region_update':
      case 'region_delete':
        if (!data.data.regionId && !data.data.region) {
          throw new Error('Region ID or region data required');
        }
        break;
    }
  }

  private generateChangeId(): string {
    return `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanupChangeStream(projectId: string): void {
    this.changeStreams.delete(projectId);
    loggingService.logInfo('Change stream cleaned up', { projectId });
  }

  /**
   * Cleanup all connections and streams
   */
  async cleanup(): Promise<void> {
    // Clear all mappings
    this.roomConnections.clear();
    this.userSockets.clear();
    this.socketUsers.clear();
    this.changeStreams.clear();

    loggingService.logInfo('ChangeStreamingService cleanup completed');
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

interface ProjectChangeData {
  projectId: string;
  changeType: ProjectChangeType;
  data: any;
  previousData?: any;
  changeId?: string;
}

interface BroadcastChange extends ProjectChangeData {
  userId: string;
  timestamp: Date;
  changeId: string;
}

interface ChangeStream {
  projectId: string;
  buffer: (BroadcastChange & { sequence: number })[];
  lastSequence: number;
  createdAt: Date;
}

interface SystemMessage {
  type: 'changes_persisted' | 'conflict_resolved' | 'sync_required' | 'error';
  data: any;
}

interface ConnectionStats {
  totalConnections: number;
  activeRooms: number;
  activeStreams: number;
  authenticatedUsers: number;
}