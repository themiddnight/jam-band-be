import { Request, Response } from 'express';
import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../services/RoomService';
import { MetronomeService } from '../services/MetronomeService';
import { NamespaceManager } from '../services/NamespaceManager';
import { RoomSessionManager } from '../services/RoomSessionManager';
import { ApprovalSessionManager } from '../services/ApprovalSessionManager';
import { loggingService } from '../services/LoggingService';
import { getHealthCheckData } from '../middleware/monitoring';
import {
  JoinRoomData,
  CreateRoomData,
  ApproveMemberData,
  RejectMemberData,
  PlayNoteData,
  ChangeInstrumentData,
  UpdateSynthParamsData,
  TransferOwnershipData,
  VoiceOfferData,
  VoiceAnswerData,
  VoiceIceCandidateData,
  JoinVoiceData,
  LeaveVoiceData,
  User,
  VoiceMuteChangedData,
  RequestVoiceParticipantsData,
  VoiceParticipantInfo,
  ChatMessageData,
  ChatMessage,
  UpdateMetronomeData,
  MetronomeTickData,
  ApprovalRequestData,
  ApprovalResponseData,
  ApprovalCancelData,
  ApprovalTimeoutData
} from '../types';

export class RoomHandlers {
  private messageQueue = new Map<string, Array<{ event: string; data: any; timestamp: number }>>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_QUEUE_SIZE = 50;
  private voiceParticipants = new Map<string, Map<string, VoiceParticipantInfo>>(); // roomId -> userId -> info
  private metronomeService: MetronomeService;
  private approvalSessionManager: ApprovalSessionManager;

  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager
  ) {
    this.metronomeService = new MetronomeService(io, roomService);
    this.approvalSessionManager = new ApprovalSessionManager();
  }

  // Batch message processing for better performance using namespace isolation
  private processBatch(roomId: string): void {
    const queue = this.messageQueue.get(roomId);
    if (!queue || queue.length === 0) return;

    // Get the room namespace for proper isolation
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (!roomNamespace) {
      console.warn('Room namespace not found for batch processing:', roomId);
      return;
    }

    const messages = [...queue];
    this.messageQueue.set(roomId, []);

    // Group messages by event type and user
    const groupedMessages = messages.reduce((acc, msg) => {
      const userId = msg.data?.userId || 'system';
      const key = `${msg.event}-${userId}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(msg.data);
      return acc;
    }, {} as Record<string, any[]>);

    // Process each group, sending only the latest message per group through namespace
    Object.entries(groupedMessages).forEach(([key, dataArray]) => {
      const latestData = dataArray[dataArray.length - 1];
      const [event] = key.split('-');
      if (event) {
        roomNamespace.emit(event, latestData);
      }
    });

    this.batchTimeouts.delete(roomId);
  }

  private getVoiceRoomMap(roomId: string): Map<string, VoiceParticipantInfo> {
    if (!this.voiceParticipants.has(roomId)) {
      this.voiceParticipants.set(roomId, new Map());
    }
    return this.voiceParticipants.get(roomId)!;
  }

  // Queue message for batched processing
  private queueMessage(roomId: string, event: string, data: any): void {
    if (!this.messageQueue.has(roomId)) {
      this.messageQueue.set(roomId, []);
    }

    const queue = this.messageQueue.get(roomId)!;
    queue.push({ event, data, timestamp: Date.now() });

    // Limit queue size to prevent memory leaks
    if (queue.length > this.MAX_QUEUE_SIZE) {
      this.messageQueue.set(roomId, queue.slice(-this.MAX_QUEUE_SIZE / 2));
    }

    // Schedule batch processing if not already scheduled
    if (!this.batchTimeouts.has(roomId)) {
      const timeout = setTimeout(() => this.processBatch(roomId), this.BATCH_INTERVAL);
      this.batchTimeouts.set(roomId, timeout);
    }
  }

  // Optimized emit function that uses namespace-specific broadcasting
  private optimizedEmit(socket: Socket, roomId: string, event: string, data: any, immediate: boolean = false): void {
    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(roomId);
    if (!roomNamespace) {
      console.warn('Room namespace not found for room:', roomId);
      return;
    }

    if (immediate || event === 'note_played' || event === 'user_joined' || event === 'user_left' || event === 'synth_params_changed') {
      // Critical events are sent immediately through namespace, excluding the sender
      socket.to(roomNamespace.name).emit(event, data);
      console.log(`🎛️ Broadcasting ${event} to namespace ${roomNamespace.name}:`, data);
    } else {
      // Other events are batched for better performance
      this.queueMessage(roomId, event, data);
    }
  }

  /**
   * Helper method to get or create room namespace
   * This ensures the namespace exists before we try to use it
   */
  private getOrCreateRoomNamespace(roomId: string): Namespace | null {
    let roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (!roomNamespace) {
      // Create the room namespace if it doesn't exist
      console.log('🔧 Creating room namespace for roomId:', roomId);
      try {
        roomNamespace = this.namespaceManager.createRoomNamespace(roomId);
      } catch (error) {
        console.error('❌ Failed to create room namespace for roomId:', roomId, error);
        return null;
      }
    }
    return roomNamespace;
  }

  // Private method to handle room owner leaving
  private handleRoomOwnerLeaving(roomId: string, leavingUserId: string, isIntendedLeave: boolean = false): void {
    const room = this.roomService.getRoom(roomId);
    if (!room) return;

    const leavingUser = room.users.get(leavingUserId);
    if (!leavingUser) return;

    // Store the old owner information before removing them
    const oldOwner = { ...leavingUser };

    // Remove the leaving user from room
    this.roomService.removeUserFromRoom(roomId, leavingUserId, isIntendedLeave);

    // For unintentional leave (like page refresh), keep the room alive if owner is alone
    if (!isIntendedLeave) {
      // Check if room is now empty after owner disconnect
      if (this.roomService.shouldCloseRoom(roomId)) {
        // Don't close the room immediately for unintentional disconnects
        // The owner is in grace period and can rejoin
        return;
      }

      // For unintentional disconnects, delay ownership transfer until grace period expires
      // This prevents the double owner issue when room owners refresh the page
      setTimeout(() => {
        // Check if the user is still in grace period (hasn't rejoined)
        if (this.roomService.isUserInGracePeriod(leavingUserId, roomId)) {
          // Grace period expired, user hasn't rejoined - proceed with ownership transfer
          this.handleDelayedOwnershipTransfer(roomId, oldOwner);
        }
        // If user is no longer in grace period, they have rejoined - no transfer needed
      }, this.roomService.getGracePeriodMs()); // Use the grace period duration from RoomService

      return;
    }

    // For intentional leave, proceed with immediate ownership transfer
    this.handleImmediateOwnershipTransfer(roomId, leavingUser, oldOwner);
  }

  // Handle immediate ownership transfer for intentional leaves
  private handleImmediateOwnershipTransfer(roomId: string, leavingUser: any, oldOwner: any): void {
    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(roomId);
    if (!roomNamespace) {
      console.warn('Room namespace not found for ownership transfer:', roomId);
      return;
    }

    // First, notify all users that the owner is leaving
    roomNamespace.emit('user_left', { user: leavingUser });

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomId)) {
      roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
      this.metronomeService.cleanupRoom(roomId);
      this.namespaceManager.cleanupRoomNamespace(roomId);
      this.namespaceManager.cleanupApprovalNamespace(roomId);
      this.roomService.deleteRoom(roomId);

      // Broadcast to all clients that the room was closed (via main namespace)
      this.io.emit('room_closed_broadcast', { roomId });
      return;
    }

    // Try to transfer ownership to any remaining user
    const newOwner = this.roomService.getAnyUserInRoom(roomId);
    if (newOwner) {
      const result = this.roomService.transferOwnership(roomId, newOwner.id, oldOwner);
      if (result) {
        roomNamespace.emit('ownership_transferred', {
          newOwner: result.newOwner,
          oldOwner: result.oldOwner
        });

        // Send updated room state to all users to ensure UI consistency
        const room = this.roomService.getRoom(roomId);
        if (room) {
          const updatedRoomData = {
            room: {
              ...room,
              users: this.roomService.getRoomUsers(roomId),
              pendingMembers: this.roomService.getPendingMembers(roomId)
            }
          };
          roomNamespace.emit('room_state_updated', updatedRoomData);
        }
      }
    }
  }

  // Handle delayed ownership transfer for unintentional disconnects
  private handleDelayedOwnershipTransfer(roomId: string, oldOwner: any): void {
    const room = this.roomService.getRoom(roomId);
    if (!room) return;

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(roomId);
    if (!roomNamespace) {
      console.warn('Room namespace not found for delayed ownership transfer:', roomId);
      return;
    }

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomId)) {
      roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
      this.metronomeService.cleanupRoom(roomId);
      this.namespaceManager.cleanupRoomNamespace(roomId);
      this.namespaceManager.cleanupApprovalNamespace(roomId);
      this.roomService.deleteRoom(roomId);

      // Broadcast to all clients that the room was closed (via main namespace)
      this.io.emit('room_closed_broadcast', { roomId });
      return;
    }

    // Try to transfer ownership to any remaining user
    const newOwner = this.roomService.getAnyUserInRoom(roomId);
    if (newOwner) {
      const result = this.roomService.transferOwnership(roomId, newOwner.id, oldOwner);
      if (result) {
        roomNamespace.emit('ownership_transferred', {
          newOwner: result.newOwner,
          oldOwner: result.oldOwner
        });

        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomId),
            pendingMembers: this.roomService.getPendingMembers(roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }
    }
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

  getRoomList(req: Request, res: Response): void {
    const roomList = this.roomService.getAllRooms();
    res.json(roomList);
  }

  handleCreateRoomHttp(req: Request, res: Response): void {
    // Import validation at the top of the file if not already imported
    const { validateData, createRoomSchema } = require('../validation/schemas');

    // Validate request body
    const validationResult = validateData(createRoomSchema, req.body);
    if (validationResult.error) {
      res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
      return;
    }

    const { name, username, userId, isPrivate = false, isHidden = false } = validationResult.value;

    try {
      const { room, user } = this.roomService.createRoom(
        name,
        username,
        userId,
        isPrivate,
        isHidden
      );

      // Create room namespace and start metronome for the new room
      const roomNamespace = this.namespaceManager.createRoomNamespace(room.id);
      this.metronomeService.initializeRoomMetronome(room.id, roomNamespace);

      // Create approval namespace for private rooms
      if (room.isPrivate) {
        this.namespaceManager.createApprovalNamespace(room.id);
      }

      // Broadcast to all clients that a new room was created (via main namespace)
      this.io.emit('room_created_broadcast', {
        id: room.id,
        name: room.name,
        userCount: room.users.size,
        owner: room.owner,
        isPrivate: room.isPrivate,
        isHidden: room.isHidden,
        createdAt: room.createdAt.toISOString()
      });

      res.status(201).json({
        success: true,
        room: {
          ...room,
          users: this.roomService.getRoomUsers(room.id),
          pendingMembers: this.roomService.getPendingMembers(room.id)
        },
        user
      });
    } catch (error) {
      console.error('Error creating room:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create room'
      });
    }
  }

  handleLeaveRoomHttp(req: Request, res: Response): void {
    const { roomId } = req.params;
    const { userId } = req.body;

    if (!roomId || !userId) {
      res.status(400).json({
        success: false,
        message: 'Missing required parameters: roomId and userId'
      });
      return;
    }

    const room = this.roomService.getRoom(roomId);
    if (!room) {
      res.status(404).json({
        success: false,
        message: 'Room not found'
      });
      return;
    }

    const user = this.roomService.findUserInRoom(roomId, userId);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found in room'
      });
      return;
    }

    // Remove user from room with intentional leave flag
    const removedUser = this.roomService.removeUserFromRoom(roomId, userId, true);

    if (!removedUser) {
      res.status(500).json({
        success: false,
        message: 'Failed to remove user from room'
      });
      return;
    }

    // Handle room owner leaving
    if (user.role === 'room_owner') {
      this.handleImmediateOwnershipTransfer(roomId, user, user);
    } else {
      // Check if room should be closed after regular user leaves
      if (this.roomService.shouldCloseRoom(roomId)) {
        // Get or create the room namespace for proper isolation
        const roomNamespace = this.getOrCreateRoomNamespace(roomId);
        if (roomNamespace) {
          roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
        }
        this.metronomeService.cleanupRoom(roomId);
        this.namespaceManager.cleanupRoomNamespace(roomId);
        this.namespaceManager.cleanupApprovalNamespace(roomId);
        this.roomService.deleteRoom(roomId);

        // Broadcast to all clients that the room was closed (via main namespace)
        this.io.emit('room_closed_broadcast', { roomId });
      } else {
        // Get or create the room namespace for proper isolation
        const roomNamespace = this.getOrCreateRoomNamespace(roomId);
        if (roomNamespace) {
          // Notify others about user leaving
          roomNamespace.emit('user_left', { user });

          // Send updated room state to all users to ensure UI consistency
          const updatedRoomData = {
            room: {
              ...room,
              users: this.roomService.getRoomUsers(roomId),
              pendingMembers: this.roomService.getPendingMembers(roomId)
            }
          };
          roomNamespace.emit('room_state_updated', updatedRoomData);
        }
      }
    }

    res.json({
      success: true,
      message: 'Successfully left room',
      roomClosed: this.roomService.shouldCloseRoom(roomId)
    });
  }

  // Socket Event Handlers
  handleJoinRoom(socket: Socket, data: JoinRoomData): void {
    const { roomId, username, userId, role } = data;

    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Check if user already exists in the room, is in grace period, or has intentionally left
    const existingUser = this.roomService.findUserInRoom(roomId, userId);
    const isInGracePeriod = this.roomService.isUserInGracePeriod(userId, roomId);
    const hasIntentionallyLeft = this.roomService.hasUserIntentionallyLeft(userId, roomId);

    let user: User;
    let userIntentionallyLeft = hasIntentionallyLeft;

    if (existingUser) {
      // User already exists in room, use their existing data (e.g., page refresh)
      user = existingUser;
      // Remove from grace period if they were there
      this.roomService.removeFromGracePeriod(userId, roomId);
    } else if (isInGracePeriod) {
      // User is in grace period, restore them to the room
      // Requirements: 6.7 - State restoration (user role, instrument, settings) after reconnection
      const gracePeriodUserData = this.roomService.getGracePeriodUserData(userId, roomId);
      if (gracePeriodUserData) {
        // Restore user with their original role and data
        user = {
          ...gracePeriodUserData,
          username, // Update username in case it changed
        };
        this.roomService.removeFromGracePeriod(userId, roomId);
      } else {
        // Grace period expired, create new user
        user = {
          id: userId,
          username,
          role: role || 'audience',
          isReady: (role || 'audience') === 'audience'
        };
      }
    } else if (hasIntentionallyLeft) {
      // User has intentionally left this room - they need approval to rejoin
      // Remove them from the intentional leave list since they're trying to rejoin
      this.roomService.removeFromIntentionallyLeft(userId);

      // Create new user that will need approval
      user = {
        id: userId,
        username,
        role: role || 'audience',
        isReady: (role || 'audience') === 'audience'
      };

      // Mark that this user intentionally left (for the approval logic below)
      userIntentionallyLeft = true;
    } else {
      // Create new user
      user = {
        id: userId,
        username,
        role: role || 'audience',
        isReady: (role || 'audience') === 'audience'
      };
    }

    // Set up session
    const session = { roomId, userId };
    socket.data = session;
    this.roomSessionManager.setRoomSession(roomId, socket.id, session);

    // Remove old sessions for this user
    this.roomSessionManager.removeOldSessionsForUser(userId, socket.id);

    if (existingUser) {
      // User already exists in room, join them directly (e.g., page refresh)
      socket.join(roomId);

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomId);
      if (roomNamespace) {
        // Notify others in room about the rejoin
        socket.to(roomId).emit('user_joined', { user });

        // Auto-request synth parameters from existing synth users for the rejoining user
        console.log(`🎛️ [EXISTING] About to call autoRequestSynthParamsForNewUser for existing user ${user.username} (${user.id}) in room ${roomId}`);
        this.autoRequestSynthParamsForNewUser(socket, roomId, user.id);
        this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomId, user.id);

        socket.emit('room_joined', {
          room,
          users: this.roomService.getRoomUsers(roomId),
          pendingMembers: this.roomService.getPendingMembers(roomId),
        });

        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomId),
            pendingMembers: this.roomService.getPendingMembers(roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }
    } else if (isInGracePeriod) {
      // User is in grace period (disconnected, not intentionally left), restore them to the room
      this.roomService.addUserToRoom(roomId, user);
      this.roomService.removeFromGracePeriod(userId);

      socket.join(roomId);

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomId);
      if (roomNamespace) {
        // Notify others in room about the rejoin
        socket.to(roomId).emit('user_joined', { user });

        // Auto-request synth parameters from existing synth users for the grace period user
        console.log(`🎛️ [GRACE] About to call autoRequestSynthParamsForNewUser for grace period user ${user.username} (${user.id}) in room ${roomId}`);
        this.autoRequestSynthParamsForNewUser(socket, roomId, user.id);
        this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomId, user.id);

        socket.emit('room_joined', {
          room,
          users: this.roomService.getRoomUsers(roomId),
          pendingMembers: this.roomService.getPendingMembers(roomId)
        });

        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomId),
            pendingMembers: this.roomService.getPendingMembers(roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }
    } else if (role === 'band_member' && room.isPrivate) {
      // Requesting to join as band member in a private room - redirect to approval namespace
      socket.emit('redirect_to_approval', {
        roomId,
        message: 'Private room requires approval. Please connect to approval namespace.',
        approvalNamespace: `/approval/${roomId}`
      });
    } else {
      // New audience member or band member in public room - join directly
      this.roomService.addUserToRoom(roomId, user);

      socket.join(roomId);

      console.log('🏠 User joining room:', {
        socketId: socket.id,
        roomId,
        userId: user.id,
        username: user.username
      });

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomId);
      if (roomNamespace) {
        console.log('📡 Room namespace ready:', {
          namespaceName: roomNamespace.name,
          connectedSockets: roomNamespace.sockets.size
        });

        // Notify others in room
        socket.to(roomId).emit('user_joined', { user });

        // Auto-request synth parameters from existing synth users for the new user
        console.log(`🎛️ [MAIN] About to call autoRequestSynthParamsForNewUser for user ${user.username} (${user.id}) in room ${roomId}`);
        this.autoRequestSynthParamsForNewUser(socket, roomId, user.id);
        
        // Also request via namespace for better reliability
        this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomId, user.id);

        socket.emit('room_joined', {
          room,
          users: this.roomService.getRoomUsers(roomId),
          pendingMembers: this.roomService.getPendingMembers(roomId)
        });

        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomId),
            pendingMembers: this.roomService.getPendingMembers(roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      } else {
        console.error('❌ Failed to create room namespace for roomId:', roomId);
      }
    }
  }

  handleApproveMember(socket: Socket, data: ApproveMemberData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      return;
    }

    if (!this.roomService.isRoomOwner(session.roomId, session.userId)) {
      return;
    }

    const approvedUser = this.roomService.approveMember(session.roomId, data.userId);
    if (!approvedUser) {
      return;
    }

    // Notify the approved user
    const approvedSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, data.userId);
    if (approvedSocketId) {
      const approvedSocket = this.io.sockets.sockets.get(approvedSocketId);
      if (approvedSocket) {
        approvedSocket.emit('member_approved', {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(session.roomId),
            pendingMembers: this.roomService.getPendingMembers(session.roomId)
          }
        });
        approvedSocket.join(session.roomId);
      }
    }

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Notify all users in room about the new member (including the approver)
      roomNamespace.emit('user_joined', { user: approvedUser });

      // Auto-request synth parameters from existing synth users for the approved user
      console.log(`🎛️ [APPROVED] About to call autoRequestSynthParamsForNewUser for approved user ${approvedUser.username} (${approvedUser.id}) in room ${session.roomId}`);
      this.autoRequestSynthParamsForNewUser(socket, session.roomId, approvedUser.id);
      this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, session.roomId, approvedUser.id);

      // Send updated room state to all users to ensure UI consistency
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(session.roomId),
          pendingMembers: this.roomService.getPendingMembers(session.roomId)
        }
      };
      roomNamespace.emit('room_state_updated', updatedRoomData);
    }
  }

  handleRejectMember(socket: Socket, data: RejectMemberData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      return;
    }

    if (!this.roomService.isRoomOwner(session.roomId, session.userId)) {
      return;
    }

    const rejectedUser = this.roomService.rejectMember(session.roomId, data.userId);
    if (!rejectedUser) {
      return;
    }

    // Notify the rejected user
    const rejectedSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, data.userId);
    if (rejectedSocketId) {
      const rejectedSocket = this.io.sockets.sockets.get(rejectedSocketId);
      if (rejectedSocket) {
        // Send rejection message - the frontend will handle disconnection
        rejectedSocket.emit('member_rejected', { message: 'Your request was rejected', userId: data.userId });
      }
    }

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Send updated room state to all users in the room (excluding the rejected user)
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(session.roomId),
          pendingMembers: this.roomService.getPendingMembers(session.roomId)
        }
      };
      roomNamespace.emit('room_state_updated', updatedRoomData);
    }
  }

  handlePlayNote(socket: Socket, data: PlayNoteData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Update user's current instrument
    this.roomService.updateUserInstrument(session.roomId, session.userId, data.instrument, data.category);

    // Use optimized emit for better performance
    this.optimizedEmit(socket, session.roomId, 'note_played', {
      userId: session.userId,
      username: user.username,
      notes: data.notes,
      velocity: data.velocity,
      instrument: data.instrument,
      category: data.category,
      eventType: data.eventType,
      isKeyHeld: data.isKeyHeld
    }, true); // Note events are critical and sent immediately
  }

  handleChangeInstrument(socket: Socket, data: ChangeInstrumentData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    this.roomService.updateUserInstrument(session.roomId, session.userId, data.instrument, data.category);

    // First, send stop all notes event to immediately stop all notes for this user
    this.optimizedEmit(socket, session.roomId, 'stop_all_notes', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Stop all notes events are critical and sent immediately

    // Then, send instrument changed event
    this.optimizedEmit(socket, session.roomId, 'instrument_changed', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Instrument changes are important and sent immediately

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Send updated room state to all users to ensure UI consistency
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(session.roomId),
          pendingMembers: this.roomService.getPendingMembers(session.roomId)
        }
      };
      roomNamespace.emit('room_state_updated', updatedRoomData);
    }
  }

  handleStopAllNotes(socket: Socket, data: { instrument: string; category: string }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Send stop all notes event to all users in the room
    this.optimizedEmit(socket, session.roomId, 'stop_all_notes', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Stop all notes events are critical and sent immediately
  }

  handleUpdateSynthParams(socket: Socket, data: UpdateSynthParamsData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Synth params now bypass validation for performance

    // Use optimized emit for better performance - synth params need immediate transmission
    this.optimizedEmit(socket, session.roomId, 'synth_params_changed', {
      userId: session.userId,
      username: user.username,
      instrument: user.currentInstrument || '',
      category: user.currentCategory || '',
      params: data.params
    }, true); // Synth params need immediate transmission for real-time audio
  }

  handleRequestSynthParams(socket: Socket): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const requestingUser = room.users.get(session.userId);
    if (!requestingUser) return;

    // Find all users with synthesizers in the room
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== session.userId
    );

    // Notify other synth users to send their parameters
    synthUsers.forEach(synthUser => {
      const synthUserSocketId = this.roomSessionManager.findSocketByUserId(session.roomId, synthUser.id);
      if (synthUserSocketId) {
        const synthUserSocket = this.io.sockets.sockets.get(synthUserSocketId);
        if (synthUserSocket) {
          synthUserSocket.emit('request_synth_params_response', {
            requestingUserId: session.userId,
            requestingUsername: requestingUser.username
          });
        }
      }
    });
  }

  // Auto-request synth parameters for new users joining the room
  private autoRequestSynthParamsForNewUser(socket: Socket, roomId: string, newUserId: string): void {
    console.log(`🎛️ [DEBUG] Auto-request synth params called for new user: ${newUserId} in room: ${roomId}`);
    
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      console.log(`🎛️ [DEBUG] No room found for roomId: ${roomId}`);
      return;
    }

    const newUser = room.users.get(newUserId);
    if (!newUser) {
      console.log(`🎛️ [DEBUG] No new user found for userId: ${newUserId}`);
      return;
    }

    // Debug: Log all users in the room and their categories
    console.log(`🎛️ [DEBUG] All users in room ${roomId}:`);
    Array.from(room.users.values()).forEach(user => {
      console.log(`  - ${user.username} (${user.id}): category="${user.currentCategory}", instrument="${user.currentInstrument}"`);
    });

    // Find all users with synthesizers in the room (excluding the new user)
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== newUserId
    );

    console.log(`🎛️ Auto-requesting synth params for new user ${newUser.username} from ${synthUsers.length} synth users`);

    // Notify existing synth users to send their parameters to the new user
    synthUsers.forEach(synthUser => {
      const synthUserSocketId = this.roomSessionManager.findSocketByUserId(roomId, synthUser.id);
      if (synthUserSocketId) {
        const synthUserSocket = this.io.sockets.sockets.get(synthUserSocketId);
        if (synthUserSocket) {
          console.log(`🎛️ Requesting synth params from ${synthUser.username} for new user ${newUser.username}`);
          synthUserSocket.emit('auto_send_synth_params_to_new_user', {
            newUserId: newUserId,
            newUsername: newUser.username
          });
        } else {
          console.log(`🎛️ [DEBUG] No socket found for synth user ${synthUser.username}`);
        }
      } else {
        console.log(`🎛️ [DEBUG] No socket ID found for synth user ${synthUser.username}`);
      }
    });
  }

  // Auto-request synth parameters for new users joining the room (namespace version)
  private autoRequestSynthParamsForNewUserNamespace(namespace: Namespace, roomId: string, newUserId: string): void {
    console.log(`🎛️ [DEBUG] [Namespace] Auto-request synth params called for new user: ${newUserId} in room: ${roomId}`);
    
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      console.log(`🎛️ [DEBUG] [Namespace] No room found for roomId: ${roomId}`);
      return;
    }

    const newUser = room.users.get(newUserId);
    if (!newUser) {
      console.log(`🎛️ [DEBUG] [Namespace] No new user found for userId: ${newUserId}`);
      return;
    }

    // Debug: Log all users in the room and their categories
    console.log(`🎛️ [DEBUG] [Namespace] All users in room ${roomId}:`);
    Array.from(room.users.values()).forEach(user => {
      console.log(`  - ${user.username} (${user.id}): category="${user.currentCategory}", instrument="${user.currentInstrument}"`);
    });

    // Find all users with synthesizers in the room (excluding the new user)
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== newUserId
    );

    console.log(`🎛️ [Namespace] Auto-requesting synth params for new user ${newUser.username} from ${synthUsers.length} synth users`);

    if (synthUsers.length === 0) {
      console.log(`🎛️ [Namespace] No synthesizer users found to request params from`);
      return;
    }

    // Notify existing synth users to send their parameters to the new user
    synthUsers.forEach(synthUser => {
      // Find the socket in the namespace for this synth user
      for (const [socketId, socket] of namespace.sockets) {
        const session = this.roomSessionManager.getRoomSession(socketId);
        if (session && session.userId === synthUser.id) {
          console.log(`🎛️ [Namespace] Requesting synth params from ${synthUser.username} for new user ${newUser.username}`);
          
          // Send both events to ensure reliability
          socket.emit('auto_send_synth_params_to_new_user', {
            newUserId: newUserId,
            newUsername: newUser.username
          });
          
          // Also send a direct request for current synth params
          socket.emit('request_current_synth_params_for_new_user', {
            newUserId: newUserId,
            newUsername: newUser.username,
            synthUserId: synthUser.id,
            synthUsername: synthUser.username
          });
          break;
        }
      }
    });
  }

  handleTransferOwnership(socket: Socket, data: TransferOwnershipData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const result = this.roomService.transferOwnership(session.roomId, data.newOwnerId);
    if (!result) return;

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Notify all users in room
      roomNamespace.emit('ownership_transferred', {
        newOwner: result.newOwner,
        oldOwner: result.oldOwner
      });

      // Send updated room state to all users to ensure UI consistency
      const room = this.roomService.getRoom(session.roomId);
      if (room) {
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(session.roomId),
            pendingMembers: this.roomService.getPendingMembers(session.roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }
    }
  }

  handleLeaveRoom(socket: Socket, isIntendedLeave: boolean = false): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      return;
    }

    const user = room.users.get(session.userId);
    const pendingUser = room.pendingMembers.get(session.userId);

    // Check if this was a pending member who cancelled
    if (pendingUser) {
      this.roomService.rejectMember(session.roomId, session.userId);

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
      if (roomNamespace) {
        // Send updated room state to all users in the room to remove the pending member
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(session.roomId),
            pendingMembers: this.roomService.getPendingMembers(session.roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }

      this.roomSessionManager.removeSession(socket.id);
      return;
    }

    if (!user) {
      return;
    }

    // If room owner leaves, handle ownership transfer or room closure
    if (user.role === 'room_owner') {
      // Notify the leaving owner that their leave is confirmed before handling transfer
      socket.emit('leave_confirmed', { message: 'Successfully left the room' });
      this.handleRoomOwnerLeaving(session.roomId, session.userId, isIntendedLeave);
    } else {
      // Regular user leaving - just remove them from room
      // Notify the leaving user that their leave is confirmed
      socket.emit('leave_confirmed', { message: 'Successfully left the room' });
      this.roomService.removeUserFromRoom(session.roomId, session.userId, isIntendedLeave);

      // Check if room should be closed after regular user leaves
      if (this.roomService.shouldCloseRoom(session.roomId)) {
        // Get or create the room namespace for proper isolation
        const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
        if (roomNamespace) {
          roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
        }
        this.metronomeService.cleanupRoom(session.roomId);
        this.namespaceManager.cleanupRoomNamespace(session.roomId);
        this.namespaceManager.cleanupApprovalNamespace(session.roomId);
        this.roomService.deleteRoom(session.roomId);

        // Broadcast to all clients that the room was closed (via main namespace)
        this.io.emit('room_closed_broadcast', { roomId: session.roomId });
      } else {
        // Get or create the room namespace for proper isolation
        const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
        if (roomNamespace) {
          // Notify others about user leaving
          socket.to(session.roomId).emit('user_left', { user });

          // Send updated room state to all users to ensure UI consistency
          const updatedRoomData = {
            room: {
              ...room,
              users: this.roomService.getRoomUsers(session.roomId),
              pendingMembers: this.roomService.getPendingMembers(session.roomId)
            }
          };
          roomNamespace.emit('room_state_updated', updatedRoomData);
        }
      }
    }

    socket.leave(session.roomId);
    this.roomSessionManager.removeSession(socket.id);
  }

  handleCreateRoom(socket: Socket, data: CreateRoomData): void {
    // Check if socket already has a session (prevent multiple room creation)
    if (socket.data?.roomId) {
      return;
    }

    const { room, user, session } = this.roomService.createRoom(
      data.name,
      data.username,
      data.userId,
      data.isPrivate,
      data.isHidden
    );

    socket.join(room.id);
    socket.data = session;
    this.roomSessionManager.setRoomSession(room.id, socket.id, session);

    // Create room namespace and start metronome for the new room
    const roomNamespace = this.namespaceManager.createRoomNamespace(room.id);
    this.metronomeService.initializeRoomMetronome(room.id, roomNamespace);

    // Create approval namespace for private rooms
    if (room.isPrivate) {
      this.namespaceManager.createApprovalNamespace(room.id);
    }

    socket.emit('room_created', {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(room.id),
        pendingMembers: this.roomService.getPendingMembers(room.id)
      },
      user
    });

    // Broadcast to all clients that a new room was created
    socket.broadcast.emit('room_created_broadcast', {
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      owner: room.owner,
      isPrivate: room.isPrivate,
      isHidden: room.isHidden,
      createdAt: room.createdAt.toISOString()
    });
  }

  handleDisconnect(socket: Socket): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (session) {
      const room = this.roomService.getRoom(session.roomId);
      if (room) {
        const user = room.users.get(session.userId);
        const pendingUser = room.pendingMembers.get(session.userId);

        // Check if this was a pending member who disconnected
        if (pendingUser) {
          this.roomService.rejectMember(session.roomId, session.userId);

          // Send updated room state to all users in the room to remove the pending member
          const updatedRoomData = {
            room: {
              ...room,
              users: this.roomService.getRoomUsers(session.roomId),
              pendingMembers: this.roomService.getPendingMembers(session.roomId)
            }
          };
          // Get or create the room namespace for proper isolation
          const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
          if (roomNamespace) {
            roomNamespace.emit('room_state_updated', updatedRoomData);
          }

          this.roomSessionManager.removeSession(socket.id);
          return;
        }

        if (user) {
          // Handle room owner disconnection
          if (user.role === 'room_owner') {
            this.handleRoomOwnerLeaving(session.roomId, session.userId, false);
          } else {
            // Regular user disconnection - treat as temporary (grace period)
            this.roomService.removeUserFromRoom(session.roomId, session.userId, false);

            // Check if room should be closed after user disconnects
            if (this.roomService.shouldCloseRoom(session.roomId)) {
              // Get or create the room namespace for proper isolation
              const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
              if (roomNamespace) {
                roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
              }
              this.metronomeService.cleanupRoom(session.roomId);
              this.namespaceManager.cleanupRoomNamespace(session.roomId);
              this.namespaceManager.cleanupApprovalNamespace(session.roomId);
              this.roomService.deleteRoom(session.roomId);

              // Broadcast to all clients that the room was closed (via main namespace)
              this.io.emit('room_closed_broadcast', { roomId: session.roomId });
            } else {
              // Get or create the room namespace for proper isolation
              const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
              if (roomNamespace) {
                // Notify others about user disconnection
                socket.to(session.roomId).emit('user_left', { user });

                // Send updated room state to all users to ensure UI consistency
                const updatedRoomData = {
                  room: {
                    ...room,
                    users: this.roomService.getRoomUsers(session.roomId),
                    pendingMembers: this.roomService.getPendingMembers(session.roomId)
                  }
                };
                roomNamespace.emit('room_state_updated', updatedRoomData);
              }
            }
          }
        }
      }
      this.roomSessionManager.removeSession(socket.id);
    }
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
    const otherParticipants = allParticipants.filter(([id, p]) => p.userId !== data.userId);

    console.log(`[MESH] Connection request from ${data.userId}. Other participants:`,
      otherParticipants.map(([id, p]) => p.userId));

    // For full mesh: respond with all other participants this user should connect to
    socket.emit('mesh_participants', {
      participants: otherParticipants.map(([id, p]) => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        // Deterministic connection initiation based on lexicographical comparison
        shouldInitiate: data.userId.localeCompare(p.userId) < 0
      }))
    });

    // Notify each existing participant about the new user they should connect to
    otherParticipants.forEach(([id, participant]) => {
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

    // Update the participant list for remaining users to maintain mesh integrity
    socket.to(data.roomId).emit('voice_participants', {
      participants: Array.from(voiceRoomMap.values()).map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted
      }))
    });

    console.log(`[MESH] Voice participant removed from room ${data.roomId}. Remaining participants: ${voiceRoomMap.size}`);
  }

  handleVoiceMuteChanged(socket: Socket, data: VoiceMuteChangedData): void {
    if (!socket || !data?.roomId || !data?.userId) return;
    const map = this.getVoiceRoomMap(data.roomId);
    const existing = map.get(data.userId);
    if (existing) {
      existing.isMuted = data.isMuted;
    } else {
      // If we don't have the participant yet, create a placeholder entry
      map.set(data.userId, { userId: data.userId, username: 'Unknown', isMuted: data.isMuted });
    }
    // Broadcast the mute state change to the room (excluding sender)
    socket.to(data.roomId).emit('voice_mute_changed', {
      userId: data.userId,
      isMuted: data.isMuted,
    });
  }

  handleRequestVoiceParticipants(socket: Socket, data: RequestVoiceParticipantsData): void {
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

  // WebRTC Connection Health Monitoring
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
      participant.connectionStates = data.connectionStates;
    }

    // Check for failed connections and notify other participants
    Object.entries(data.connectionStates).forEach(([targetUserId, state]) => {
      if (state.connectionState === 'failed' || state.iceConnectionState === 'failed') {
        console.warn(`[VOICE HEALTH] Connection failure detected: ${userId} -> ${targetUserId}`);

        // Notify the target user that they should attempt reconnection
        const targetSocketId = this.roomSessionManager.findSocketByUserId(roomId, targetUserId);
        if (targetSocketId) {
          const targetSocket = this.io.sockets.sockets.get(targetSocketId);
          if (targetSocket) {
            targetSocket.emit('voice_connection_failed', {
              fromUserId: userId,
              roomId: roomId,
            });
          }
        }
      }
    });
  }

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

  // Periodic cleanup of stale voice connections
  cleanupStaleVoiceConnections(): void {
    const now = Date.now();
    const STALE_THRESHOLD = 60000; // 60 seconds

    for (const [roomId, voiceMap] of this.voiceParticipants.entries()) { // Changed from this.voiceRooms to this.voiceParticipants
      const staleUsers: string[] = [];

      for (const [userId, participant] of voiceMap.entries()) {
        const lastHeartbeat = participant.lastHeartbeat || 0;
        if (now - lastHeartbeat > STALE_THRESHOLD) {
          console.log(`[VOICE CLEANUP] Removing stale voice participant: ${userId} from room ${roomId}`);
          staleUsers.push(userId);
        }
      }

      // Remove stale users and notify room
      // Get the room namespace for proper isolation
      const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
      if (roomNamespace) {
        staleUsers.forEach(userId => {
          voiceMap.delete(userId);
          roomNamespace.emit('user_left_voice', { userId });
        });
      }

      // Remove empty voice rooms
      if (voiceMap.size === 0) {
        this.voiceParticipants.delete(roomId); // Changed from this.voiceRooms to this.voiceParticipants
      }
    }
  }

  // Chat Message Handler
  handleChatMessage(socket: Socket, data: ChatMessageData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.log(`Socket ${socket.id} not in any room`);
      return;
    }

    const roomId = session.roomId;
    const user = this.roomService.findUserInRoom(roomId, session.userId);

    if (!user) {
      console.log(`User ${session.userId} not found in room ${roomId}`);
      return;
    }

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      message: data.message,
      timestamp: Date.now()
    };

    // Get the room namespace for proper isolation
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      // Broadcast chat message to all users in the room
      roomNamespace.emit('chat_message', chatMessage);
    }
  }

  // Metronome handlers
  handleUpdateMetronome(socket: Socket, data: UpdateMetronomeData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Only room owner and band members can control metronome
    if (user.role !== 'room_owner' && user.role !== 'band_member') return;

    const updatedRoom = this.roomService.updateMetronomeBPM(session.roomId, data.bpm);
    if (!updatedRoom) return;

    // Update tempo in metronome service
    this.metronomeService.updateMetronomeTempo(session.roomId, data.bpm);

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Broadcast metronome state to all users in the room
      roomNamespace.emit('metronome_updated', {
        bpm: updatedRoom.metronome.bpm,
        lastTickTimestamp: updatedRoom.metronome.lastTickTimestamp
      });
    }
  }

  handleRequestMetronomeState(socket: Socket): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const metronomeState = this.roomService.getMetronomeState(session.roomId);
    if (!metronomeState) return;

    // Send current metronome state to the requesting user
    socket.emit('metronome_state', metronomeState);
  }

  // ========================================
  // NAMESPACE-AWARE EVENT HANDLERS
  // Requirements: 7.1, 7.2, 7.3, 7.4
  // ========================================

  /**
   * Handle join room through namespace - Requirements: 7.1
   */
  handleJoinRoomNamespace(socket: Socket, data: JoinRoomData, namespace: Namespace): void {
    // Set up namespace session
    this.roomSessionManager.setRoomSession(data.roomId, socket.id, {
      roomId: data.roomId,
      userId: data.userId
    });

    // Call existing join room logic
    this.handleJoinRoom(socket, data);
  }

  /**
   * Handle play note through namespace - Requirements: 7.1, 7.2
   */
  handlePlayNoteNamespace(socket: Socket, data: PlayNoteData, namespace: Namespace): void {
    console.log('🎵 handlePlayNoteNamespace called:', {
      socketId: socket.id,
      namespaceName: namespace.name,
      data: data
    });

    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.log('❌ No session found for socket:', socket.id);
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      console.log('❌ No room found for roomId:', session.roomId);
      return;
    }

    const user = room.users.get(session.userId);
    if (!user) {
      console.log('❌ No user found in room for userId:', session.userId);
      return;
    }

    console.log('✅ Broadcasting note to namespace:', {
      namespaceName: namespace.name,
      userId: session.userId,
      username: user.username,
      notes: data.notes,
      connectedSockets: namespace.sockets.size
    });

    // Update user's current instrument
    this.roomService.updateUserInstrument(session.roomId, session.userId, data.instrument, data.category);

    // Broadcast to all other users in the namespace (exclude sender)
    socket.broadcast.emit('note_played', {
      userId: session.userId,
      username: user.username,
      notes: data.notes,
      velocity: data.velocity,
      instrument: data.instrument,
      category: data.category,
      eventType: data.eventType,
      isKeyHeld: data.isKeyHeld
    });

    console.log('📤 Note broadcast completed using socket.broadcast.emit()');
  }

  /**
   * Handle change instrument through namespace - Requirements: 7.1, 7.2
   */
  handleChangeInstrumentNamespace(socket: Socket, data: ChangeInstrumentData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    this.roomService.updateUserInstrument(session.roomId, session.userId, data.instrument, data.category);

    // First, send stop all notes event to immediately stop all notes for this user
    this.optimizedEmit(socket, session.roomId, 'stop_all_notes', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Stop all notes events are critical and sent immediately

    // Then, send instrument changed event
    this.optimizedEmit(socket, session.roomId, 'instrument_changed', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Instrument changes are important and sent immediately

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Send updated room state to all users to ensure UI consistency
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(session.roomId),
          pendingMembers: this.roomService.getPendingMembers(session.roomId)
        }
      };
      roomNamespace.emit('room_state_updated', updatedRoomData);
    }
  }

  /**
   * Handle synth params update through namespace - Requirements: 7.1, 7.2
   */
  handleUpdateSynthParamsNamespace(socket: Socket, data: UpdateSynthParamsData, namespace: Namespace): void {
    console.log('🎛️ handleUpdateSynthParamsNamespace called:', {
      socketId: socket.id,
      namespaceName: namespace.name,
      params: data.params
    });
    
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.log('🚫 No session found for socket:', socket.id);
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      console.log('🚫 No room found for session:', session.roomId);
      return;
    }

    const user = room.users.get(session.userId);
    if (!user) {
      console.log('🚫 No user found for session:', session.userId);
      return;
    }

    console.log('🎛️ Broadcasting synth_params_changed to namespace:', namespace.name);
    // Broadcast to other clients in the same namespace (exclude sender)
    socket.broadcast.emit('synth_params_changed', {
      userId: session.userId,
      username: user.username,
      instrument: user.currentInstrument || '',
      category: user.currentCategory || '',
      params: data.params
    });
    
    console.log('✅ Successfully broadcasted synth_params_changed');
  }

  /**
   * Handle request synth params through namespace - Requirements: 7.1, 7.2
   */
  handleRequestSynthParamsNamespace(socket: Socket, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const requestingUser = room.users.get(session.userId);
    if (!requestingUser) return;

    // Find all users with synthesizers in the room
    const synthUsers = Array.from(room.users.values()).filter(user =>
      user.currentCategory === 'synthesizer' && user.id !== session.userId
    );

    // Notify other synth users through namespace
    synthUsers.forEach(synthUser => {
      const synthUserSessions = this.roomSessionManager.getRoomSessions(session.roomId);
      for (const [socketId, synthSession] of synthUserSessions.entries()) {
        if (synthSession.userId === synthUser.id) {
          const synthSocket = namespace.sockets.get(socketId);
          if (synthSocket) {
            synthSocket.emit('request_synth_params_response', {
              requestingUserId: session.userId,
              requestingUsername: requestingUser.username
            });
          }
        }
      }
    });
  }

  /**
   * Handle auto-send synth params to new user through namespace
   */
  handleAutoSendSynthParamsToNewUserNamespace(socket: Socket, data: { newUserId: string; newUsername: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const synthUser = room.users.get(session.userId);
    if (!synthUser || synthUser.currentCategory !== 'synthesizer') return;

    console.log(`🎛️ [Namespace] Auto-sending synth params from ${synthUser.username} to new user ${data.newUsername}`);

    // Emit to the specific new user to request their synth params and apply ours
    socket.emit('send_current_synth_params_to_new_user', {
      newUserId: data.newUserId,
      newUsername: data.newUsername
    });
  }

  /**
   * Handle direct request for current synth params for new user
   */
  handleRequestCurrentSynthParamsForNewUserNamespace(socket: Socket, data: { 
    newUserId: string; 
    newUsername: string; 
    synthUserId: string; 
    synthUsername: string; 
  }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const synthUser = room.users.get(session.userId);
    if (!synthUser || synthUser.currentCategory !== 'synthesizer' || synthUser.id !== data.synthUserId) return;

    console.log(`🎛️ [Namespace] Direct request for synth params from ${synthUser.username} to new user ${data.newUsername}`);

    // Emit back to the requesting user to send their current synth params
    socket.emit('send_synth_params_to_new_user_now', {
      newUserId: data.newUserId,
      newUsername: data.newUsername,
      synthUserId: data.synthUserId,
      synthUsername: data.synthUsername
    });
  }

  /**
   * Handle transfer ownership through namespace - Requirements: 7.1
   */
  handleTransferOwnershipNamespace(socket: Socket, data: TransferOwnershipData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const result = this.roomService.transferOwnership(session.roomId, data.newOwnerId);
    if (!result) return;

    // Notify all users in namespace
    namespace.emit('ownership_transferred', {
      newOwner: result.newOwner,
      oldOwner: result.oldOwner
    });

    // Send updated room state to all users in namespace
    const room = this.roomService.getRoom(session.roomId);
    if (room) {
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(session.roomId),
          pendingMembers: this.roomService.getPendingMembers(session.roomId)
        }
      };
      namespace.emit('room_state_updated', updatedRoomData);
    }
  }

  /**
   * Handle approve member through namespace - Requirements: 7.1
   */
  handleApproveMemberNamespace(socket: Socket, data: ApproveMemberData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    if (!this.roomService.isRoomOwner(session.roomId, session.userId)) return;

    const approvedUser = this.roomService.approveMember(session.roomId, data.userId);
    if (!approvedUser) return;

    // Find approved user in approval namespace and move them to room namespace
    const approvalNamespace = this.namespaceManager.getApprovalNamespace(session.roomId);
    if (approvalNamespace) {
      // Find the socket in the approval namespace by iterating through connected sockets
      for (const [socketId, socket] of approvalNamespace.sockets) {
        const approvalSession = this.approvalSessionManager.getApprovalSession(socketId);
        if (approvalSession && approvalSession.userId === data.userId) {
          // Notify approved user
          socket.emit('member_approved', {
            room: {
              ...room,
              users: this.roomService.getRoomUsers(session.roomId),
              pendingMembers: this.roomService.getPendingMembers(session.roomId)
            }
          });

          // Clean up approval session
          this.approvalSessionManager.removeApprovalSession(socketId);
          socket.disconnect();
          break;
        }
      }
    }

    // Notify all users in room namespace about the new member
    namespace.emit('user_joined', { user: approvedUser });

    // Auto-request synth parameters from existing synth users for the new user
    this.autoRequestSynthParamsForNewUserNamespace(namespace, session.roomId, approvedUser.id);

    // Send updated room state to all users in namespace
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(session.roomId),
        pendingMembers: this.roomService.getPendingMembers(session.roomId)
      }
    };
    namespace.emit('room_state_updated', updatedRoomData);
  }

  /**
   * Handle reject member through namespace - Requirements: 7.1
   */
  handleRejectMemberNamespace(socket: Socket, data: RejectMemberData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    if (!this.roomService.isRoomOwner(session.roomId, session.userId)) return;

    const rejectedUser = this.roomService.rejectMember(session.roomId, data.userId);
    if (!rejectedUser) return;

    // Find rejected user in approval namespace
    const approvalNamespace = this.namespaceManager.getApprovalNamespace(session.roomId);
    if (approvalNamespace) {
      // Find the socket in the approval namespace by iterating through connected sockets
      for (const [socketId, socket] of approvalNamespace.sockets) {
        const approvalSession = this.approvalSessionManager.getApprovalSession(socketId);
        if (approvalSession && approvalSession.userId === data.userId) {
          // Send rejection message
          socket.emit('member_rejected', {
            message: 'Your request was rejected',
            userId: data.userId
          });

          // Clean up approval session
          this.approvalSessionManager.removeApprovalSession(socketId);
          socket.disconnect();
          break;
        }
      }
    }

    // Send updated room state to all users in room namespace
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(session.roomId),
        pendingMembers: this.roomService.getPendingMembers(session.roomId)
      }
    };
    namespace.emit('room_state_updated', updatedRoomData);
  }

  // ========================================
  // WEBRTC VOICE HANDLERS - NAMESPACE AWARE
  // Requirements: 7.3
  // ========================================

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
    for (const [socketId, targetSession] of roomSessions.entries()) {
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
    for (const [socketId, targetSession] of roomSessions.entries()) {
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
    for (const [socketId, targetSession] of roomSessions.entries()) {
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

    const map = this.getVoiceRoomMap(data.roomId);
    const existing = map.get(data.userId);
    if (existing) {
      existing.isMuted = data.isMuted;
    } else {
      map.set(data.userId, { userId: data.userId, username: 'Unknown', isMuted: data.isMuted });
    }

    // Broadcast mute state change to namespace
    socket.to(namespace.name).emit('voice_mute_changed', {
      userId: data.userId,
      isMuted: data.isMuted,
    });
  }

  /**
   * Handle request voice participants through namespace - Requirements: 7.3
   */
  handleRequestVoiceParticipantsNamespace(socket: Socket, data: RequestVoiceParticipantsData, namespace: Namespace): void {
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
   * Handle request mesh connections through namespace - Requirements: 7.3
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

    // Respond with all other participants this user should connect to
    socket.emit('mesh_participants', {
      participants: otherParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        shouldInitiate: data.userId.localeCompare(p.userId) < 0
      }))
    });

    // Notify each existing participant about the new user through namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(session.roomId);
    otherParticipants.forEach(participant => {
      for (const [socketId, participantSession] of roomSessions.entries()) {
        if (participantSession.userId === participant.userId) {
          const participantSocket = namespace.sockets.get(socketId);
          if (participantSocket) {
            participantSocket.emit('new_mesh_peer', {
              userId: data.userId,
              username: voiceRoomMap.get(data.userId)?.username || 'Unknown',
              shouldInitiate: participant.userId.localeCompare(data.userId) < 0
            });
          }
        }
      }
    });
  }

  /**
   * Handle voice heartbeat through namespace - Requirements: 7.3
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
      participant.connectionStates = data.connectionStates;
    }

    // Check for failed connections and notify through namespace
    const roomSessions = this.roomSessionManager.getRoomSessions(roomId);
    Object.entries(data.connectionStates).forEach(([targetUserId, state]) => {
      if (state.connectionState === 'failed' || state.iceConnectionState === 'failed') {
        console.warn(`[VOICE HEALTH] Connection failure detected: ${userId} -> ${targetUserId}`);

        // Find target user in namespace
        for (const [socketId, targetSession] of roomSessions.entries()) {
          if (targetSession.userId === targetUserId) {
            const targetSocket = namespace.sockets.get(socketId);
            if (targetSocket) {
              targetSocket.emit('voice_connection_failed', {
                fromUserId: userId,
                roomId: roomId,
              });
            }
          }
        }
      }
    });
  }

  /**
   * Handle voice connection failed through namespace - Requirements: 7.3
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

  // ========================================
  // CHAT AND METRONOME HANDLERS - NAMESPACE AWARE
  // Requirements: 7.4
  // ========================================

  /**
   * Handle chat message through namespace - Requirements: 7.4
   */
  handleChatMessageNamespace(socket: Socket, data: ChatMessageData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      console.log(`Socket ${socket.id} not in any room`);
      return;
    }

    const roomId = session.roomId;
    const user = this.roomService.findUserInRoom(roomId, session.userId);

    if (!user) {
      console.log(`User ${session.userId} not found in room ${roomId}`);
      return;
    }

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      message: data.message,
      timestamp: Date.now()
    };

    // Broadcast chat message to all users in namespace
    namespace.emit('chat_message', chatMessage);
  }

  /**
   * Handle update metronome through namespace - Requirements: 7.4
   */
  handleUpdateMetronomeNamespace(socket: Socket, data: UpdateMetronomeData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Only room owner and band members can control metronome
    if (user.role !== 'room_owner' && user.role !== 'band_member') return;

    const updatedRoom = this.roomService.updateMetronomeBPM(session.roomId, data.bpm);
    if (!updatedRoom) return;

    // Update tempo in metronome service
    this.metronomeService.updateMetronomeTempo(session.roomId, data.bpm);

    // Broadcast metronome state to all users in namespace
    namespace.emit('metronome_updated', {
      bpm: updatedRoom.metronome.bpm,
      lastTickTimestamp: updatedRoom.metronome.lastTickTimestamp
    });
  }

  /**
   * Handle request metronome state through namespace - Requirements: 7.4
   */
  handleRequestMetronomeStateNamespace(socket: Socket, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const metronomeState = this.roomService.getMetronomeState(session.roomId);
    if (!metronomeState) return;

    // Send current metronome state to the requesting user
    socket.emit('metronome_state', metronomeState);
  }

  // ========================================
  // APPROVAL NAMESPACE HANDLERS
  // Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9
  // ========================================

  /**
   * Handle initial connection to approval namespace
   * Requirements: 3.1, 3.2
   */
  handleApprovalConnection(socket: Socket, roomId: string, approvalNamespace: Namespace): void {
    // Basic connection setup - actual session will be created when approval request is made
    loggingService.logInfo('User connected to approval namespace', {
      socketId: socket.id,
      roomId,
      namespacePath: `/approval/${roomId}`
    });
  }

  /**
   * Handle approval request in approval namespace
   * Requirements: 3.1, 3.2
   */
  handleApprovalRequest(socket: Socket, data: ApprovalRequestData, approvalNamespace: Namespace): void {
    const { roomId, userId, username, role } = data;

    // Validate room exists
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('approval_error', { message: 'Room not found' });
      return;
    }

    // Validate room is private
    if (!room.isPrivate) {
      socket.emit('approval_error', { message: 'Room is not private' });
      return;
    }

    // Check if user already has an approval session
    if (this.approvalSessionManager.hasApprovalSession(userId)) {
      socket.emit('approval_error', { message: 'You already have a pending approval request' });
      return;
    }

    // Check if user is already in the room
    if (this.roomService.findUserInRoom(roomId, userId)) {
      socket.emit('approval_error', { message: 'You are already in this room' });
      return;
    }

    // Create approval session with timeout callback
    const approvalSession = this.approvalSessionManager.createApprovalSession(
      socket.id, roomId, userId, username, role,
      (socketId, session) => this.handleApprovalTimeout(socketId, session)
    );

    // Add user to pending members in room service
    const pendingUser: User = {
      id: userId,
      username,
      role,
      isReady: role === 'audience'
    };
    this.roomService.addPendingMember(roomId, pendingUser);

    // Notify the requesting user that they're waiting for approval
    socket.emit('approval_pending', {
      message: 'Waiting for room owner approval',
      timeoutMs: this.approvalSessionManager.getApprovalTimeoutMs()
    });

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit('approval_request', {
        user: pendingUser,
        requestedAt: approvalSession.requestedAt.toISOString()
      });
    }
  }

  /**
   * Handle approval response from room owner
   * Requirements: 3.3, 3.9
   */
  handleApprovalResponse(socket: Socket, data: ApprovalResponseData, roomNamespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('approval_error', { message: 'You are not in a room' });
      return;
    }

    const room = this.roomService.getRoom(session.roomId);
    if (!room) {
      socket.emit('approval_error', { message: 'Room not found' });
      return;
    }

    // Verify user is room owner
    if (!this.roomService.isRoomOwner(session.roomId, session.userId)) {
      socket.emit('approval_error', { message: 'Only room owner can approve members' });
      return;
    }

    const { userId: targetUserId, approved } = data;

    // Check if user still has an approval session
    const approvalSession = this.approvalSessionManager.getApprovalSessionByUserId(targetUserId);
    if (!approvalSession) {
      socket.emit('approval_error', {
        message: 'User is no longer waiting for approval',
        userId: targetUserId
      });
      return;
    }

    // Get approval namespace to notify the waiting user
    const approvalNamespace = this.namespaceManager.getApprovalNamespace(session.roomId);

    if (approved) {
      // Approve the user
      const approvedUser = this.roomService.approveMember(session.roomId, targetUserId);
      if (approvedUser) {
        // Notify the approved user through approval namespace
        if (approvalNamespace) {
          // Find the socket in the approval namespace by iterating through connected sockets
          for (const [socketId, socket] of approvalNamespace.sockets) {
            const socketSession = this.approvalSessionManager.getApprovalSession(socketId);
            if (socketSession && socketSession.userId === targetUserId) {
              socket.emit('approval_granted', {
                room: {
                  ...room,
                  users: this.roomService.getRoomUsers(session.roomId),
                  pendingMembers: this.roomService.getPendingMembers(session.roomId)
                }
              });
              break;
            }
          }
        }

        // Notify all users in room about the new member
        roomNamespace.emit('user_joined', { user: approvedUser });

        // Send updated room state
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(session.roomId),
            pendingMembers: this.roomService.getPendingMembers(session.roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);

        // Confirm to room owner
        socket.emit('approval_success', {
          message: 'User approved successfully',
          userId: targetUserId,
          username: approvalSession.username
        });
      }
    } else {
      // Reject the user
      const rejectedUser = this.roomService.rejectMember(session.roomId, targetUserId);
      if (rejectedUser) {
        // Notify the rejected user through approval namespace
        if (approvalNamespace) {
          // Find the socket in the approval namespace by iterating through connected sockets
          for (const [socketId, socket] of approvalNamespace.sockets) {
            const socketSession = this.approvalSessionManager.getApprovalSession(socketId);
            if (socketSession && socketSession.userId === targetUserId) {
              socket.emit('approval_denied', {
                message: data.message || 'Your request was rejected'
              });
              break;
            }
          }
        }

        // Send updated room state to room users
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(session.roomId),
            pendingMembers: this.roomService.getPendingMembers(session.roomId)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);

        // Confirm to room owner
        socket.emit('approval_success', {
          message: 'User rejected successfully',
          userId: targetUserId,
          username: approvalSession.username
        });
      }
    }

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSessionByUserId(targetUserId);
  }

  /**
   * Handle approval cancellation from waiting user
   * Requirements: 3.6, 3.7
   */
  handleApprovalCancel(socket: Socket, data: ApprovalCancelData, approvalNamespace: Namespace): void {
    const { userId, roomId } = data;

    // Get approval session
    const approvalSession = this.approvalSessionManager.getApprovalSession(socket.id);
    if (!approvalSession) {
      socket.emit('approval_error', { message: 'No approval session found' });
      return;
    }

    // Verify session matches the request
    if (approvalSession.userId !== userId || approvalSession.roomId !== roomId) {
      socket.emit('approval_error', { message: 'Invalid cancellation request' });
      return;
    }

    // Remove from pending members
    this.roomService.rejectMember(roomId, userId);

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit('approval_request_cancelled', {
        userId,
        username: approvalSession.username,
        message: 'User cancelled their join request'
      });
    }

    // Confirm cancellation to user
    socket.emit('approval_cancelled', {
      message: 'Your request has been cancelled'
    });

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSession(socket.id);

    // Disconnect the user from approval namespace
    socket.disconnect();
  }

  /**
   * Handle approval timeout
   * Requirements: 3.4
   */
  handleApprovalTimeout(socketId: string, approvalSession: any): void {
    const { roomId, userId, username } = approvalSession;

    // Remove from pending members
    this.roomService.rejectMember(roomId, userId);

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit('approval_request_cancelled', {
        userId,
        username,
        message: 'Approval request timed out'
      });
    }

    // Notify the waiting user through approval namespace
    const approvalNamespace = this.namespaceManager.getApprovalNamespace(roomId);
    if (approvalNamespace) {
      const socket = approvalNamespace.sockets.get(socketId);
      if (socket) {
        socket.emit('approval_timeout', {
          message: 'Your approval request has timed out'
        });
        // Disconnect the socket after timeout
        socket.disconnect();
      }
    }

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSession(socketId);
  }

  /**
   * Handle approval disconnect (accidental disconnect)
   * Requirements: 3.8
   */
  handleApprovalDisconnect(socket: Socket): void {
    const approvalSession = this.approvalSessionManager.getApprovalSession(socket.id);
    if (!approvalSession) return;

    const { roomId, userId, username } = approvalSession;

    // Remove from pending members
    this.roomService.rejectMember(roomId, userId);

    // Notify room owner through room namespace
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      roomNamespace.emit('approval_request_cancelled', {
        userId,
        username,
        message: 'User disconnected'
      });
    }

    // Clean up approval session
    this.approvalSessionManager.removeApprovalSession(socket.id);
  }

  /**
   * Get approval session manager for external access
   */
  getApprovalSessionManager(): ApprovalSessionManager {
    return this.approvalSessionManager;
  }

  handleStopAllNotesNamespace(socket: Socket, data: { instrument: string; category: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Send stop all notes event to all users in the room
    this.optimizedEmit(socket, session.roomId, 'stop_all_notes', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Stop all notes events are critical and sent immediately
  }

} 