import { Request, Response } from 'express';
import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { MetronomeService } from '../../../../services/MetronomeService';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { AudioRoutingHandler } from '../../../audio-processing/infrastructure/handlers/AudioRoutingHandler';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';
import {
  JoinRoomData,
  CreateRoomData,
  User,
  UserSession
} from '../../../../types';
import { EventBus } from '../../../../shared/domain/events/EventBus';
import { RoomCreated, MemberJoined, MemberLeft } from '../../../../shared/domain/events/RoomEvents';
import { UserJoinedRoom } from '../../../../shared/domain/events/UserOnboardingEvents';

/**
 * RoomLifecycleHandler - Handles room creation, joining, and leaving operations
 * Extracted from RoomHandlers.ts as part of DDD refactoring
 * Requirements: 4.1, 4.6
 */
export class RoomLifecycleHandler {
  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager,
    private metronomeService: MetronomeService,
    private audioRoutingHandler?: AudioRoutingHandler,
    private eventBus?: EventBus
  ) { }

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
  private async handleRoomOwnerLeaving(roomId: string | RoomId, leavingUserId: string | UserId, isIntendedLeave: boolean = false): Promise<void> {
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

    // Publish MemberLeft event for intentional leaves to notify lobby
    // For unintentional leaves, we don't publish immediately as the user might rejoin
    if (isIntendedLeave && this.eventBus) {
      const memberLeftEvent = new MemberLeft(
        roomIdString,
        leavingUserIdString,
        leavingUser.username
      );
      await this.eventBus.publish(memberLeftEvent);
    }

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
   * Delegates to AudioRoutingHandler for proper audio domain handling
   */
  private autoRequestSynthParamsForNewUser(socket: Socket, roomId: string | RoomId, newUserId: string | UserId): void {
    const roomIdString = this.roomIdToString(this.ensureRoomId(roomId));
    const newUserIdString = this.userIdToString(this.ensureUserId(newUserId));

    // Delegate to AudioRoutingHandler which handles all audio-related functionality
    // If audioRoutingHandler is not provided (e.g., in tests), skip this functionality
    if (this.audioRoutingHandler) {
      this.audioRoutingHandler.autoRequestSynthParamsForNewUser(socket, roomIdString, newUserIdString);
    }
  }

  /**
   * Auto-request synth parameters via namespace for better reliability
   * Delegates to AudioRoutingHandler for proper audio domain handling
   */
  private autoRequestSynthParamsForNewUserNamespace(roomNamespace: Namespace, roomId: string | RoomId, newUserId: string | UserId): void {
    const roomIdString = this.roomIdToString(this.ensureRoomId(roomId));
    const newUserIdString = this.userIdToString(this.ensureUserId(newUserId));

    // Delegate to AudioRoutingHandler which handles all audio-related functionality
    // If audioRoutingHandler is not provided (e.g., in tests), skip this functionality
    if (this.audioRoutingHandler) {
      this.audioRoutingHandler.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomIdString, newUserIdString);
    }
  }

  /**
   * Handle room creation via HTTP
   */
  async handleCreateRoomHttp(req: Request, res: Response): Promise<void> {
    // Import validation at the top of the file if not already imported
    const { validateData, createRoomSchema } = require('../../../../validation/schemas');

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

    const { name, username, userId, isPrivate = false, isHidden = false, description, roomType = 'perform' } = validationResult.value;

    try {
      // Convert to strongly-typed IDs for internal processing
      const userIdTyped = this.ensureUserId(userId);

      const { room, user } = this.roomService.createRoom(
        name,
        username,
        this.userIdToString(userIdTyped), // Convert back to string for legacy service
        isPrivate,
        isHidden,
        description,
        roomType
      );

      // Convert room.id to RoomId for type safety
      const roomIdTyped = this.ensureRoomId(room.id);

      // Create room namespace and start metronome for the new room
      const roomNamespace = this.namespaceManager.createRoomNamespace(this.roomIdToString(roomIdTyped));
      this.metronomeService.initializeRoomMetronome(this.roomIdToString(roomIdTyped), roomNamespace);

      // Create approval namespace for private rooms
      if (room.isPrivate) {
        this.namespaceManager.createApprovalNamespace(this.roomIdToString(roomIdTyped));
      }

      // Publish domain event for room creation
      if (this.eventBus) {
        const roomCreatedEvent = new RoomCreated(
          roomIdTyped.toString(),
          this.userIdToString(userIdTyped),
          room.name,
          room.isPrivate
        );
        await this.eventBus.publish(roomCreatedEvent);
      }

      // Broadcast to all clients that a new room was created (via main namespace)
      this.io.emit('room_created_broadcast', {
        id: roomIdTyped.toString(),
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
          users: this.roomService.getRoomUsers(this.roomIdToString(roomIdTyped)),
          pendingMembers: this.roomService.getPendingMembers(this.roomIdToString(roomIdTyped))
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
  async handleCreateRoom(socket: Socket, data: CreateRoomData): Promise<void> {
    // Check if socket already has a session (prevent multiple room creation)
    if (socket.data?.roomId) {
      return;
    }

    // Convert to strongly-typed IDs for internal processing
    const userIdTyped = this.ensureUserId(data.userId);

    const { room, user, session } = this.roomService.createRoom(
      data.name,
      data.username,
      this.userIdToString(userIdTyped), // Convert back to string for legacy service
      data.isPrivate,
      data.isHidden,
      data.description,
      data.roomType
    );

    // Convert room.id to RoomId for type safety
    const roomIdTyped = this.ensureRoomId(room.id);
    const roomIdString = this.roomIdToString(roomIdTyped);

    socket.join(roomIdString);
    socket.data = session;
    this.roomSessionManager.setRoomSession(roomIdString, socket.id, session);

    // Create room namespace and start metronome for the new room
    const roomNamespace = this.namespaceManager.createRoomNamespace(roomIdString);
    this.metronomeService.initializeRoomMetronome(roomIdString, roomNamespace);

    // Create approval namespace for private rooms
    if (room.isPrivate) {
      this.namespaceManager.createApprovalNamespace(roomIdString);
    }

    socket.emit('room_created', {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(roomIdString),
        pendingMembers: this.roomService.getPendingMembers(roomIdString)
      },
      user
    });

    // Publish domain event for room creation
    if (this.eventBus) {
      const roomCreatedEvent = new RoomCreated(
        roomIdString,
        this.userIdToString(userIdTyped),
        room.name,
        room.isPrivate
      );
      await this.eventBus.publish(roomCreatedEvent);
    }

    // Broadcast to all clients that a new room was created
    socket.broadcast.emit('room_created_broadcast', {
      id: roomIdTyped.toString(),
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
  async handleJoinRoom(socket: Socket, data: JoinRoomData): Promise<void> {
    const { roomId, username, userId, role } = data;

    // Validate input
    if (!roomId || !username || !userId) {
      socket.emit('join_error', { message: 'Missing required fields: roomId, username, userId' });
      return;
    }

    const roomIdTyped = this.ensureRoomId(roomId);
    const userIdTyped = this.ensureUserId(userId);
    const roomIdString = this.roomIdToString(roomIdTyped);
    const userIdString = this.userIdToString(userIdTyped);

    const room = this.roomService.getRoom(roomIdString);
    if (!room) {
      socket.emit('join_error', { message: 'Room not found' });
      return;
    }

    // Check if user is already connected with a different socket
    // This prevents duplicate connections and role conflicts
    // For now, we'll rely on removeOldSessionsForUser which is called later
    // TODO: Implement findSessionByUserId method in RoomSessionManager if needed for better validation

    const existingUser = this.roomService.findUserInRoom(roomIdString, userIdString);
    const isInGracePeriod = this.roomService.isUserInGracePeriod(userIdString, roomIdString);
    const hasIntentionallyLeft = this.roomService.hasUserIntentionallyLeft(userIdString, roomIdString);

    let user: User;

    if (existingUser) {
      // User already exists in room, use their existing data (e.g., page refresh)
      user = existingUser;
      // Remove from grace period if they were there
      this.roomService.removeFromGracePeriod(userIdString, roomIdString);
    } else if (isInGracePeriod) {
      // User is in grace period, restore them to the room
      // Requirements: 6.7 - State restoration (user role, instrument, settings) after reconnection
      const gracePeriodUserData = this.roomService.getGracePeriodUserData(userIdString, roomIdString);
      if (gracePeriodUserData) {
        // Check if the user is trying to join with a different role than they had before
        const requestedRole: 'room_owner' | 'band_member' | 'audience' = role || 'audience';
        const previousRole = gracePeriodUserData.role;

        // Preserve room owner role if user had it before (they can't request it via join)
        const shouldPreserveOwnerRole = previousRole === 'room_owner';

        if (shouldPreserveOwnerRole) {
          console.log(
            `👑 Preserving room owner role for ${username} during grace period reconnection (requested ${requestedRole})`
          );
          user = {
            ...gracePeriodUserData,
            username,
          };
        } else if (requestedRole !== previousRole) {
          console.log(`🔄 User ${username} changing role from ${previousRole} to ${requestedRole} during grace period`);
          user = {
            id: userIdString,
            username,
            role: requestedRole,
            isReady: requestedRole === 'audience',
            // Don't restore instrument data when role changes - let user choose fresh
          };
        } else {
          // Same role - restore user with their original data (instruments, settings, etc.)
          user = {
            ...gracePeriodUserData,
            username, // Update username in case it changed
          };
        }
        this.roomService.removeFromGracePeriod(userIdString, roomIdString);
      } else {
        // Grace period expired, create new user
        const userRole = role || 'audience';
        user = {
          id: userIdString,
          username,
          role: userRole,
          isReady: userRole === 'audience',
          // Don't set default instruments - let frontend send user's preferences
          // currentInstrument and currentCategory will be set when user sends change_instrument
        };
      }
    } else if (hasIntentionallyLeft) {
      // User has intentionally left this room - they need approval to rejoin
      // Remove them from the intentional leave list since they're trying to rejoin
      this.roomService.removeFromIntentionallyLeft(userIdString);

      // Create new user that will need approval
      const userRole = role || 'audience';
      user = {
        id: userIdString,
        username,
        role: userRole,
        isReady: userRole === 'audience',
        // Don't set default instruments - let frontend send user's preferences
        // currentInstrument and currentCategory will be set when user sends change_instrument
      };

      // Note: This user intentionally left and is trying to rejoin
    } else {
      // Create new user
      const userRole = role || 'audience';
      user = {
        id: userIdString,
        username,
        role: userRole,
        isReady: userRole === 'audience',
        // Don't set default instruments - let frontend send user's preferences
        // currentInstrument and currentCategory will be set when user sends change_instrument
      };
    }

    // Set up session
    const session: UserSession = { roomId: roomIdString, userId: userIdString };
    socket.data = session;
    this.roomSessionManager.setRoomSession(roomIdString, socket.id, session);

    // Remove old sessions for this user
    this.roomSessionManager.removeOldSessionsForUser(userIdString, socket.id);

    if (existingUser) {
      // User already exists in room, join them directly (e.g., page refresh)
      this.roomService.ensureUserEffectChains(user);
      socket.join(roomIdString);

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
      if (roomNamespace) {
        // Notify others in room about the rejoin
        socket.to(roomIdString).emit('user_joined', { user });

        // Auto-request synth parameters from existing synth users for the rejoining user
        console.log(`🎛️ [EXISTING] About to call autoRequestSynthParamsForNewUser for existing user ${user.username} (${user.id}) in room ${roomIdTyped.toString()}`);
        this.autoRequestSynthParamsForNewUser(socket, roomIdTyped, userIdTyped);
        this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomIdTyped, userIdTyped);

        socket.emit('room_joined', {
          room,
          users: this.roomService.getRoomUsers(roomIdString),
          pendingMembers: this.roomService.getPendingMembers(roomIdString),
          effectChains: user.effectChains,
          self: user
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
    } else if (isInGracePeriod) {
      // User is in grace period (disconnected, not intentionally left), restore them to the room
      this.roomService.addUserToRoom(roomIdString, user);
      this.roomService.removeFromGracePeriod(userIdString);

      this.roomService.ensureUserEffectChains(user);
      socket.join(roomIdString);

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
      if (roomNamespace) {
        // Notify others in room about the rejoin
        socket.to(roomIdString).emit('user_joined', { user });

        // Auto-request synth parameters from existing synth users for the grace period user
        console.log(`🎛️ [GRACE] About to call autoRequestSynthParamsForNewUser for grace period user ${user.username} (${user.id}) in room ${roomIdTyped.toString()}`);
        this.autoRequestSynthParamsForNewUser(socket, roomIdTyped, userIdTyped);
        this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomIdTyped, userIdTyped);

        socket.emit('room_joined', {
          room,
          users: this.roomService.getRoomUsers(roomIdString),
          pendingMembers: this.roomService.getPendingMembers(roomIdString),
          effectChains: user.effectChains,
          self: user
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
    } else if (role === 'band_member' && room.isPrivate) {
      // Requesting to join as band member in a private room - redirect to approval namespace
      socket.emit('redirect_to_approval', {
        roomId: roomIdTyped.toString(),
        message: 'Private room requires approval. Please connect to approval namespace.',
        approvalNamespace: `/approval/${roomIdTyped.toString()}`
      });
    } else {
      // New audience member or band member in public room - join directly
      this.roomService.addUserToRoom(roomIdString, user);

      this.roomService.ensureUserEffectChains(user);
      // Publish domain events for user joining
      if (this.eventBus) {
        const memberJoinedEvent = new MemberJoined(
          roomIdString,
          userIdString,
          user.username,
          user.role
        );
        await this.eventBus.publish(memberJoinedEvent);

        // Also publish UserJoinedRoom event to start onboarding coordination
        const userJoinedRoomEvent = new UserJoinedRoom(
          roomIdString,
          userIdString,
          user.username,
          user.role
        );
        await this.eventBus.publish(userJoinedRoomEvent);
      }

      socket.join(roomIdString);

      console.log('🏠 User joining room:', {
        socketId: socket.id,
        roomId: roomIdTyped.toString(),
        userId: user.id,
        username: user.username
      });

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
      if (roomNamespace) {
        console.log('📡 Room namespace ready:', {
          namespaceName: roomNamespace.name,
          connectedSockets: roomNamespace.sockets.size
        });

        // Notify others in room
        socket.to(roomIdString).emit('user_joined', { user });

        // Auto-request synth parameters from existing synth users for the new user
        console.log(`🎛️ [MAIN] About to call autoRequestSynthParamsForNewUser for user ${user.username} (${user.id}) in room ${roomIdTyped.toString()}`);
        this.autoRequestSynthParamsForNewUser(socket, roomIdTyped, userIdTyped);

        // Also request via namespace for better reliability
        this.autoRequestSynthParamsForNewUserNamespace(roomNamespace, roomIdTyped, userIdTyped);

        socket.emit('room_joined', {
          room,
          users: this.roomService.getRoomUsers(roomIdString),
          pendingMembers: this.roomService.getPendingMembers(roomIdString),
          effectChains: user.effectChains,
          self: user
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
      } else {
        console.error('❌ Failed to create room namespace for roomId:', roomIdTyped.toString());
      }
    }
  }

  /**
   * Handle user leaving room - coordinates cleanup and state updates
   * Requirements: 6.5, 6.6, 6.7 - Grace period management, session cleanup, state restoration
   */
  async handleLeaveRoom(socket: Socket, isIntendedLeave: boolean = false): Promise<void> {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      // No session found - user might have already left or never joined properly
      console.log('🚪 Leave room called but no session found for socket:', socket.id);
      socket.emit('leave_confirmed', { message: 'Successfully left the room' });
      return;
    }

    const roomIdString = session.roomId;
    const userIdString = session.userId;
    const room = this.roomService.getRoom(roomIdString);
    const user = room?.users.get(userIdString);

    // Always confirm the leave to the user first to prevent UI hanging
    socket.emit('leave_confirmed', { message: 'Successfully left the room' });

    // Remove user from socket room immediately to prevent further message reception
    socket.leave(roomIdString);

    if (!room) {
      console.log('🚪 Room not found during leave:', roomIdString);
      this.roomSessionManager.removeSession(socket.id);
      return;
    }

    if (!user) {
      console.log('🚪 User not found in room during leave:', userIdString, 'from room:', roomIdString);
      // Still broadcast room state update in case there's a sync issue
      const roomNamespace = this.getOrCreateRoomNamespace(roomIdString);
      if (roomNamespace) {
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomIdString),
            pendingMembers: this.roomService.getPendingMembers(roomIdString)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }

      this.roomSessionManager.removeSession(socket.id);
      return;
    }

    // If room owner leaves, handle ownership transfer or room closure
    if (user.role === 'room_owner') {
      await this.handleRoomOwnerLeaving(session.roomId, session.userId, isIntendedLeave);
    } else {
      // Regular user leaving - remove them from room
      this.roomService.removeUserFromRoom(session.roomId, session.userId, isIntendedLeave);

      // Publish MemberLeft event for intentional leaves to notify lobby
      if (isIntendedLeave && this.eventBus) {
        const memberLeftEvent = new MemberLeft(
          session.roomId,
          session.userId,
          user.username
        );
        await this.eventBus.publish(memberLeftEvent);
      }

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);

      // Check if room should be closed after regular user leaves
      if (this.roomService.shouldCloseRoom(session.roomId)) {
        if (roomNamespace) {
          roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
        }

        // Attempt to close room
        this.roomService.deleteRoom(session.roomId);
      } else {
        // Room still has users, notify others and broadcast updated state
        if (roomNamespace) {
          // First, emit user_left event so frontend can clean up immediately
          roomNamespace.emit('user_left', { user });

          // Then, send updated room state to all users to ensure UI consistency
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

    // Clean up session last
    this.roomSessionManager.removeSession(socket.id);

    console.log('🚪 User left room:', {
      username: user.username,
      role: user.role,
      roomId: roomIdString,
      isIntendedLeave,
      socketId: socket.id
    });
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

    // Convert to strongly-typed IDs for internal processing
    const roomIdTyped = this.ensureRoomId(roomId);
    const userIdTyped = this.ensureUserId(userId);
    const roomIdString = this.roomIdToString(roomIdTyped);
    const userIdString = this.userIdToString(userIdTyped);

    const room = this.roomService.getRoom(roomIdString);
    if (!room) {
      res.status(404).json({
        success: false,
        message: 'Room not found'
      });
      return;
    }

    const user = this.roomService.findUserInRoom(roomIdString, userIdString);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found in room'
      });
      return;
    }

    // Remove user from room with intentional leave flag
    const removedUser = this.roomService.removeUserFromRoom(roomIdString, userIdString, true);

    if (!removedUser) {
      res.status(500).json({
        success: false,
        message: 'Failed to remove user from room'
      });
      return;
    }

    // Handle room owner leaving
    if (user.role === 'room_owner') {
      this.handleImmediateOwnershipTransfer(roomIdTyped, user, user);
    } else {
      // Check if room should be closed after regular user leaves
      if (this.roomService.shouldCloseRoom(roomIdString)) {
        // Get or create the room namespace for proper isolation
        const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
        if (roomNamespace) {
          roomNamespace.emit('room_closed', { message: 'Room is empty and has been closed' });
        }
        this.metronomeService.cleanupRoom(roomIdString);
        this.namespaceManager.cleanupRoomNamespace(roomIdString);
        this.namespaceManager.cleanupApprovalNamespace(roomIdString);
        this.roomService.deleteRoom(roomIdString);

        // Broadcast to all clients that the room was closed (via main namespace)
        this.io.emit('room_closed_broadcast', { roomId: roomIdTyped.toString() });
      } else {
        // Get or create the room namespace for proper isolation
        const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
        if (roomNamespace) {
          // Notify others about user leaving
          roomNamespace.emit('user_left', { user });

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

    res.json({
      success: true,
      message: 'Successfully left room',
      roomClosed: this.roomService.shouldCloseRoom(roomIdString)
    });
  }

  /**
   * Handle room settings update via HTTP
   */
  async handleUpdateRoomSettingsHttp(req: Request, res: Response): Promise<void> {
    const { validateData, updateRoomSettingsSchema } = require('../../../../validation/schemas');

    // Validate request body
    const validationResult = validateData(updateRoomSettingsSchema, req.body);
    if (validationResult.error) {
      res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
      return;
    }

    const { roomId } = req.params;
    const { name, description, isPrivate, isHidden, updatedBy } = validationResult.value;

    if (!roomId) {
      res.status(400).json({
        success: false,
        message: 'Room ID is required'
      });
      return;
    }

    try {
      // Convert to strongly-typed IDs for internal processing
      const roomIdTyped = this.ensureRoomId(roomId);
      const updatedByTyped = this.ensureUserId(updatedBy);
      const roomIdString = this.roomIdToString(roomIdTyped);
      const updatedByString = this.userIdToString(updatedByTyped);

      const room = this.roomService.getRoom(roomIdString);
      if (!room) {
        res.status(404).json({
          success: false,
          message: 'Room not found'
        });
        return;
      }

      // Check if user is the room owner
      const user = this.roomService.findUserInRoom(roomIdString, updatedByString);
      if (!user || user.role !== 'room_owner') {
        res.status(403).json({
          success: false,
          message: 'Only room owner can update room settings'
        });
        return;
      }

      // Update room settings
      const oldSettings = {
        name: room.name,
        description: room.description,
        isPrivate: room.isPrivate,
        isHidden: room.isHidden
      };

      // Apply updates using RoomService method (includes cache invalidation)
      const updateSuccess = this.roomService.updateRoomSettings(roomIdString, {
        name,
        description,
        isPrivate,
        isHidden
      });

      if (!updateSuccess) {
        res.status(500).json({
          success: false,
          message: 'Failed to update room settings'
        });
        return;
      }

      // Get the updated room object
      const updatedRoom = this.roomService.getRoom(roomIdString);
      if (!updatedRoom) {
        res.status(500).json({
          success: false,
          message: 'Failed to retrieve updated room'
        });
        return;
      }

      // Get or create the room namespace for proper isolation
      const roomNamespace = this.getOrCreateRoomNamespace(roomIdTyped);
      if (roomNamespace) {
        // Notify all users in the room about the settings change
        roomNamespace.emit('room_settings_updated', {
          roomId: roomIdString,
          updatedBy: updatedByString,
          oldSettings,
          newSettings: {
            name: updatedRoom.name,
            description: updatedRoom.description,
            isPrivate: updatedRoom.isPrivate,
            isHidden: updatedRoom.isHidden
          }
        });

        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...updatedRoom,
            users: this.roomService.getRoomUsers(roomIdString),
            pendingMembers: this.roomService.getPendingMembers(roomIdString)
          }
        };
        roomNamespace.emit('room_state_updated', updatedRoomData);
      }

      // Handle privacy changes - create/cleanup approval namespace
      if (oldSettings.isPrivate !== updatedRoom.isPrivate) {
        if (updatedRoom.isPrivate && !oldSettings.isPrivate) {
          // Room became private - create approval namespace
          this.namespaceManager.createApprovalNamespace(roomIdString);
        } else if (!updatedRoom.isPrivate && oldSettings.isPrivate) {
          // Room became public - cleanup approval namespace
          this.namespaceManager.cleanupApprovalNamespace(roomIdString);
        }
      }

      // Broadcast room update to lobby (for room list updates)
      const roomUpdateData = {
        id: roomIdString,
        name: updatedRoom.name,
        description: updatedRoom.description,
        userCount: updatedRoom.users.size,
        owner: updatedRoom.owner,
        isPrivate: updatedRoom.isPrivate,
        isHidden: updatedRoom.isHidden,
        updatedAt: new Date().toISOString()
      };

      // Emit to main namespace (for any connected clients)
      this.io.emit('room_updated_broadcast', roomUpdateData);

      // Also emit to lobby-monitor namespace (for lobby clients)
      const lobbyNamespace = this.namespaceManager.getLobbyMonitorNamespace();
      if (lobbyNamespace) {
        lobbyNamespace.emit('room_updated_broadcast', roomUpdateData);
      }

      res.json({
        success: true,
        message: 'Room settings updated successfully',
        room: {
          ...updatedRoom,
          users: this.roomService.getRoomUsers(roomIdString),
          pendingMembers: this.roomService.getPendingMembers(roomIdString)
        }
      });
    } catch (error) {
      console.error('Error updating room settings:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update room settings'
      });
    }
  }
}