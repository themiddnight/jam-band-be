import { Request, Response } from 'express';
import { Socket, Namespace } from 'socket.io';

import { RoomService } from '../services/RoomService';
import { RoomSessionManager } from '../services/RoomSessionManager';

// Domain Handlers - Following DDD best practices
import { RoomLifecycleHandler, RoomMembershipHandler } from '../domains/room-management/infrastructure/handlers';
import { ApprovalWorkflowHandler } from '../domains/user-management/infrastructure/handlers';
import { RoomApplicationService } from '../domains/room-management/application/RoomApplicationService';

// Value Objects for type safety
import { RoomId, UserId } from '../shared/domain/models/ValueObjects';

import { getHealthCheckData } from '../middleware/monitoring';
import {
  JoinRoomData,
  TransferOwnershipData,
} from '../types';

/**
 * RoomHandlers - Coordination layer following DDD best practices
 * 
 * This class serves as a coordination layer that:
 * 1. Delegates domain-specific operations to appropriate domain handlers
 * 2. Handles cross-domain coordination when needed
 * 3. Manages HTTP endpoints and basic socket coordination
 * 4. Does NOT contain business logic (that belongs in domain handlers)
 * 
 * Domain Handler Delegation:
 * - Room lifecycle operations → RoomLifecycleHandler (room-management domain)
 * - Member management → RoomMembershipHandler (room-management domain)  
 * - Approval workflows → ApprovalWorkflowHandler (user-management domain)
 * - Audio routing → AudioRoutingHandler (audio-processing domain)
 * - Voice connections → VoiceConnectionHandler (real-time-communication domain)
 * - Chat messages → ChatHandler (real-time-communication domain)
 * - Note playing → NotePlayingHandler (audio-processing domain)
 * - Metronome → MetronomeHandler (room-management domain)
 */
export class RoomHandlers {
  constructor(
    private roomService: RoomService,
    private roomSessionManager: RoomSessionManager,
    private roomLifecycleHandler: RoomLifecycleHandler,
    private roomMembershipHandler: RoomMembershipHandler,
    private approvalWorkflowHandler: ApprovalWorkflowHandler,
    private roomApplicationService?: RoomApplicationService
  ) {}

  // Helper methods for type safety while maintaining backward compatibility
  private ensureRoomId(roomId: string | RoomId): RoomId {
    return typeof roomId === 'string' ? RoomId.fromString(roomId) : roomId;
  }

  private ensureUserId(userId: string | UserId): UserId {
    return typeof userId === 'string' ? UserId.fromString(userId) : userId;
  }

  private roomIdToString(roomId: string | RoomId): string {
    return typeof roomId === 'string' ? roomId : roomId.toString();
  }

  private userIdToString(userId: string | UserId): string {
    return typeof userId === 'string' ? userId : userId.toString();
  }

  // HTTP Handlers
  getHealthCheck(req: Request, res: Response): void {
    try {
      const healthData = getHealthCheckData();
      res.json(healthData);
    } catch (error) {
      console.error('Health check error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        status: 'error',
        message: 'Health check failed',
        error: process.env.NODE_ENV === 'development' ? errorMessage : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  getRoomList(_req: Request, res: Response): void {
    const roomList = this.roomService.getAllRooms();
    res.json(roomList);
  }

  handleCreateRoomHttp(req: Request, res: Response): void {
    this.roomLifecycleHandler.handleCreateRoomHttp(req, res);
  }

  handleLeaveRoomHttp(req: Request, res: Response): void {
    this.roomLifecycleHandler.handleLeaveRoomHttp(req, res);
  }

  // Socket Event Handlers - Delegation to domain handlers

  /**
   * Handle ownership transfer - delegates to RoomMembershipHandler
   * This is coordination logic that manages namespace communication
   * Uses strongly-typed value objects for type safety
   */
  handleTransferOwnership(socket: Socket, data: TransferOwnershipData): void {
    // Get roomId from socket session
    const session = this.roomSessionManager.getSession(socket.id);
    if (!session) return;
    
    // Ensure type safety with value objects
    const roomId = this.ensureRoomId(session.roomId);
    const newOwnerId = this.ensureUserId(data.newOwnerId);
    
    // Create typed data for domain handler
    const typedData = {
      ...data,
      roomId: roomId.toString(),
      newOwnerId: newOwnerId.toString()
    };
    
    // Delegate to domain handler for business logic
    this.roomMembershipHandler.handleTransferOwnership(socket, typedData);
  }

  /**
   * Handle socket disconnection - coordinates between domain handlers
   * This is cross-domain coordination logic with type safety
   */
  async handleDisconnect(socket: Socket): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    // Use strongly-typed value objects
    const roomId = this.ensureRoomId(session.roomId);
    const userId = this.ensureUserId(session.userId);

    const room = this.roomService.getRoom(this.roomIdToString(roomId));
    if (!room) {
      this.roomSessionManager.removeSession(socket.id);
      return;
    }

    const user = room.users.get(this.userIdToString(userId));
    const pendingUser = room.pendingMembers.get(this.userIdToString(userId));

    // Handle pending member disconnection through approval workflow handler
    if (pendingUser) {
      this.approvalWorkflowHandler.handleApprovalDisconnect(socket);
      this.roomSessionManager.removeSession(socket.id);
      return;
    }

    // Handle regular member disconnection through lifecycle handler
    if (user) {
      await this.roomLifecycleHandler.handleLeaveRoom(socket, false);
    }

    this.roomSessionManager.removeSession(socket.id);
  }

  // Namespace-aware Event Handlers - Requirements: 7.1, 7.2, 7.3, 7.4
  handleJoinRoomNamespace(socket: Socket, data: JoinRoomData): void {
    // Use strongly-typed value objects for type safety
    const roomId = this.ensureRoomId(data.roomId);
    const userId = this.ensureUserId(data.userId);
    
    this.roomSessionManager.setRoomSession(this.roomIdToString(roomId), socket.id, {
      roomId: this.roomIdToString(roomId),
      userId: this.userIdToString(userId)
    });
    
    // Create typed data for domain handler
    const typedData = {
      ...data,
      roomId: this.roomIdToString(roomId),
      userId: this.userIdToString(userId)
    };
    
    this.roomLifecycleHandler.handleJoinRoom(socket, typedData);
  }

  /**
   * Handle ownership transfer through namespace - delegates to domain handler
   * Uses strongly-typed value objects for type safety
   */
  handleTransferOwnershipNamespace(socket: Socket, data: TransferOwnershipData, namespace: Namespace): void {
    // Get roomId from socket session
    const session = this.roomSessionManager.getSession(socket.id);
    if (!session) return;
    
    // Ensure type safety with value objects
    const roomId = this.ensureRoomId(session.roomId);
    const newOwnerId = this.ensureUserId(data.newOwnerId);
    
    // Create typed data for domain handler
    const typedData = {
      ...data,
      roomId: roomId.toString(),
      newOwnerId: newOwnerId.toString()
    };
    
    // Delegate to domain handler which handles namespace-aware operations
    this.roomMembershipHandler.handleTransferOwnershipNamespace(socket, typedData, namespace);
  }

  /**
   * Handle room owner scale change - update room state and notify followers
   */
  handleRoomOwnerScaleChange(socket: Socket, data: import('../types').RoomOwnerScaleChangeData, namespace: Namespace): void {
    const session = this.roomSessionManager.getSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    // Only room owner can change the room scale
    if (room.owner !== session.userId) {
      socket.emit('error', { message: 'Only room owner can change the room scale' });
      return;
    }

    // Update room's owner scale
    room.ownerScale = {
      rootNote: data.rootNote,
      scale: data.scale
    };

    // Notify all users in the room about the scale change
    namespace.emit('room_owner_scale_changed', {
      rootNote: data.rootNote,
      scale: data.scale,
      ownerId: session.userId
    });
  }

  /**
   * Handle toggle follow room owner - update user follow state
   */
  handleToggleFollowRoomOwner(socket: Socket, data: import('../types').ToggleFollowRoomOwnerData, namespace: Namespace): void {
    const session = this.roomSessionManager.getSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Only band members can follow room owner (not audience or room owner themselves)
    if (user.role !== 'band_member') {
      socket.emit('error', { message: 'Only band members can follow room owner scale' });
      return;
    }

    // Update user's follow state
    user.followRoomOwner = data.followRoomOwner;

    // Notify the user about their follow state change
    socket.emit('follow_room_owner_toggled', {
      followRoomOwner: data.followRoomOwner,
      ownerScale: room.ownerScale
    });

    // If they're now following and there's an owner scale, send it
    if (data.followRoomOwner && room.ownerScale) {
      socket.emit('room_owner_scale_changed', {
        rootNote: room.ownerScale.rootNote,
        scale: room.ownerScale.scale,
        ownerId: room.owner
      });
    }

    // Notify room participants about follow state change for awareness
    namespace.emit('room_member_follow_state_changed', {
      userId: session.userId,
      followRoomOwner: data.followRoomOwner
    });
  }
}