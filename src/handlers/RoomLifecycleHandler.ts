import { Request, Response } from 'express';
import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../services/RoomService';
import { MetronomeService } from '../services/MetronomeService';
import { NamespaceManager } from '../services/NamespaceManager';
import { RoomSessionManager } from '../services/RoomSessionManager';
import { loggingService } from '../services/LoggingService';
import { RoomId, UserId } from '../shared/domain/models/ValueObjects';
import {
  JoinRoomData,
  CreateRoomData,
  User,
  UserSession
} from '../types';

/**
 * RoomLifecycleHandler - Handles room creation, joining, and leaving operations
 * Extracted from RoomHandlers.ts as part of DDD refactoring
 * Requirements: 4.1, 4.6
 */
export class RoomLifecycleHandler {
  private metronomeService: MetronomeService;

  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager
  ) {
    this.metronomeService = new MetronomeService(io, roomService);
  }

  /**
   * Helper method to ensure RoomId type safety while maintaining backward compatibility
   */
  private ensureRoomId(roomId: string | RoomId): RoomId {
    return typeof roomId === 'string' ? RoomId.fromString(roomId) : roomId;
  }

  /**
   * Helper method to ensure UserId type safety while maintaining backward compatibility
   */
  private ensureUserId(userId: string | UserId): UserId {
    return typeof userId === 'string' ? UserId.fromString(userId) : userId;
  }

  /**
   * Helper method to convert RoomId to string for legacy service calls
   */
  private roomIdToString(roomId: string | RoomId): string {
    return typeof roomId === 'string' ? roomId : roomId.toString();
  }

  /**
   * Helper method to convert UserId to string for legacy service calls
   */
  private userIdToString(userId: string | UserId): string {
    return typeof userId === 'string' ? userId : userId.toString();
  }

  /**
   * Helper method to get or create room namespace
   * This ensures the namespace exists before we try to use it
   */
  private getOrCreateRoomNamespace(roomId: string | RoomId): Namespace | null {
    const roomIdTyped = this.ensureRoomId(roomId);
    const roomIdString = this.roomIdToString(roomIdTyped);
    
    let roomNamespace = this.namespaceManager.getRoomNamespace(roomIdString);
    if (!roomNamespace) {
      // Create the room namespace if it doesn't exist
      console.log('🔧 Creating room namespace for roomId:', roomIdTyped.toString());
      try {
        roomNamespace = this.namespaceManager.createRoomNamespace(roomIdString);
      } catch (error) {
        console.error('❌ Failed to create room namespace for roomId:', roomIdTyped.toString(), error);
        return null;
      }
    }
    return roomNamespace;
  }

  /**
   * Private method to handle room owner leaving
   */
  private handleRoomOwnerLeaving(roomId: string | RoomId, leavingUserId: string | UserId, isIntendedLeave: boolean = false): void {
    const roomIdTyped = this.ensureRoomId(roomId);
    const leavingUserIdTyped = this.ensureUserId(leavingUserId);
    const roomIdString = this.roomIdToString(roomIdTyped);
    const leavingUserIdString = this.userIdToString(leavingUserIdTyped);

    const room = this.roomService.getRoom(roomIdString);
    if (!room) return;

    const leavingUser = room.users.get(leavingUserIdString);
    if (!leavingUser) return;

    // Store the old owner information before removing them
    const oldOwner = { ...leavingUser };

    // Remove the leaving user from room
    this.roomService.removeUserFromRoom(roomIdString, leavingUserIdString, isIntendedLeave);

    // For unintentional leave (like page refresh), keep the room alive if owner is alone
    if (!isIntendedLeave) {
      // Check if room is now empty after owner disconnect
      if (this.roomService.shouldCloseRoom(roomIdString)) {
        // Don't close the room immediately for unintentional disconnects
        // The owner is in grace period and can rejoin
        return;
      }

      // For unintentional disconnects, delay ownership transfer until grace period expires
      // This prevents the double owner issue when room owners refresh the page
      setTimeout(() => {
        // Check if the user is still in grace period (hasn't rejoined)
        if (this.roomService.isUserInGracePeriod(leavingUserIdString, roomIdString)) {
          // Grace period expired, user hasn't rejoined - proceed with ownership transfer
          this.handleDelayedOwnershipTransfer(roomIdTyped, oldOwner);
        }
        // If user is no longer in grace period, they have rejoined - no transfer needed
      }, this.roomService.getGracePeriodMs()); // Use the grace period duration from RoomService

      return;
    }

    // For intentional leave, proceed with immediate ownership transfer
    this.handleImmediateOwnershipTransfer(roomIdTyped, leavingUser, oldOwner);
  }

  /**
   * Handle immediate ownership transfer for intentional leaves
   */
  private handleImmediateOwnershipTransfer(roomId: string | RoomId, leavingUser: any, oldOwner: any): void {
    const roomIdTyped = this.ensureRoomId(roomId);
    const roomIdString = this.roomIdToString(roomIdTyped);

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
    if (!roomNamespace) {
      console.warn('Room namespace not found for ownership transfer:', roomIdTyped.toString());
      return;
    }

    // First, notify all users that the owner is leaving
    roomNamespace.emit('user_left', { user: leavingUser });

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomIdString)) {
      roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
      this.metronomeService.cleanupRoom(roomIdString);
      this.namespaceManager.cleanupRoomNamespace(roomIdString);
      this.namespaceManager.cleanupApprovalNamespace(roomIdString);
      this.roomService.deleteRoom(roomIdString);

      // Broadcast to all clients that the room was closed (via main namespace)
      this.io.emit('room_closed_broadcast', { roomId: roomIdTyped.toString() });
      return;
    }

    // Try to transfer ownership to any remaining user
    const newOwner = this.roomService.getAnyUserInRoom(roomIdString);
    if (newOwner) {
      const result = this.roomService.transferOwnership(roomIdString, newOwner.id, oldOwner);
      if (result) {
        roomNamespace.emit('ownership_transferred', {
          newOwner: result.newOwner,
          oldOwner: result.oldOwner
        });

        // Send updated room state to all users to ensure UI consistency
        const room = this.roomService.getRoom(roomIdString);
        if (room) {
          const updatedRoomData = {
            room: {
              ...room,
              users: this.roomService.getRoomUsers(roomIdString),
              pendingMembers: this.roomService.getPendingMembers(roomIdString)
            }
          };
          roomNamespace.emit('room_state_updated', updatedRoomData);
        }
      }
    }
  }

  /**
   * Handle delayed ownership transfer for unintentional disconnects
   */
  private handleDelayedOwnershipTransfer(roomId: string | RoomId, oldOwner: any): void {
    const roomIdTyped = this.ensureRoomId(roomId);
    const roomIdString = this.roomIdToString(roomIdTyped);

    const room = this.roomService.getRoom(roomIdString);
    if (!room) return;

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
    if (!roomNamespace) {
      console.warn('Room namespace not found for delayed ownership transfer:', roomIdTyped.toString());
      return;
    }

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomIdString)) {
      roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
      this.metronomeService.cleanupRoom(roomIdString);
      this.namespaceManager.cleanupRoomNamespace(roomIdString);
      this.namespaceManager.cleanupApprovalNamespace(roomIdString);
      this.roomService.deleteRoom(roomIdString);

      // Broadcast to all clients that the room was closed (via main namespace)
      this.io.emit('room_closed_broadcast', { roomId: roomIdTyped.toString() });
      return;
    }

    // Try to transfer ownership to any remaining user
    const newOwner = this.roomService.getAnyUserInRoom(roomIdString);
    if (newOwner) {
      const result = this.roomService.transferOwnership(roomIdString, newOwner.id, oldOwner);
      if (result) {
        roomNamespace.emit('ownership_transferred', {
          newOwner: result.newOwner,
          oldOwner: result.oldOwner
        });

        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomIdString),
            pendingMembers: this.roomService.getPendingMembers(roomIdString)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }
    }
  }

  /**
   * Auto-request synth parameters from existing synth users for a new user
   */
  private autoRequestSynthParamsForNewUser(socket: Socket, roomId: string | RoomId, newUserId: string | UserId): void {
    const roomIdTyped = this.ensureRoomId(roomId);
    const newUserIdTyped = this.ensureUserId(newUserId);
    const roomIdString = this.roomIdToString(roomIdTyped);
    const newUserIdString = this.userIdToString(newUserIdTyped);

    const room = this.roomService.getRoom(roomIdString);
    if (!room) return;

    // Find all users with synth instruments
    const synthUsers = Array.from(room.users.values()).filter(user => 
      user.currentCategory === 'synth' && user.id !== newUserIdString
    );

    console.log(`🎛️ Found ${synthUsers.length} synth users in room ${roomIdTyped.toString()} for new user ${newUserIdTyped.toString()}`);

    // Request synth params from each synth user
    synthUsers.forEach(synthUser => {
      console.log(`🎛️ Requesting synth params from ${synthUser.username} (${synthUser.id}) for new user ${newUserIdTyped.toString()}`);
      socket.to(roomIdString).emit('request_synth_params', {
        requesterId: newUserIdString,
        targetUserId: synthUser.id
      });
    });
  }

  /**
   * Auto-request synth parameters via namespace for better reliability
   */
  private autoRequestSynthParamsForNewUserNamespace(roomNamespace: Namespace, roomId: string | RoomId, newUserId: string | UserId): void {
    const roomIdTyped = this.ensureRoomId(roomId);
    const newUserIdTyped = this.ensureUserId(newUserId);
    const roomIdString = this.roomIdToString(roomIdTyped);
    const newUserIdString = this.userIdToString(newUserIdTyped);

    const room = this.roomService.getRoom(roomIdString);
    if (!room) return;

    // Find all users with synth instruments
    const synthUsers = Array.from(room.users.values()).filter(user => 
      user.currentCategory === 'synth' && user.id !== newUserIdString
    );

    console.log(`🎛️ [NAMESPACE] Found ${synthUsers.length} synth users in room ${roomIdTyped.toString()} for new user ${newUserIdTyped.toString()}`);

    // Request synth params from each synth user via namespace
    synthUsers.forEach(synthUser => {
      console.log(`🎛️ [NAMESPACE] Requesting synth params from ${synthUser.username} (${synthUser.id}) for new user ${newUserIdTyped.toString()}`);
      roomNamespace.emit('request_synth_params', {
        requesterId: newUserIdString,
        targetUserId: synthUser.id
      });
    });
  }

  /**
   * Handle room creation via HTTP
   */
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

  /**
   * Handle room creation via Socket
   */
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

  /**
   * Handle joining a room via Socket
   */
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
    const session: UserSession = { roomId, userId };
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

  /**
   * Handle leaving a room via Socket
   */
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

  /**
   * Handle leaving a room via HTTP
   */
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
}