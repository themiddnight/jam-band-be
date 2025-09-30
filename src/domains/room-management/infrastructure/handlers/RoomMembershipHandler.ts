import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { loggingService } from '../../../../services/LoggingService';
import {
  User,
  TransferOwnershipData
} from '../../../../types';

/**
 * RoomMembershipHandler - Handles room member management operations
 * 
 * This handler manages member-related operations within rooms:
 * - Member approval for private rooms
 * - Member rejection for private rooms
 * - Member-related coordination logic
 * - Room state updates after membership changes
 * 
 * Requirements: 4.1, 4.6
 */
export class RoomMembershipHandler {
  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager
  ) {}

  /**
   * Handle member approval - approves a pending member to join the room
   * Requirements: 4.1, 4.6
   */
  handleApproveMember(socket: Socket, data: { userId: string; roomId?: string }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('membership_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = data.roomId || session.roomId;
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('membership_error', { message: 'Room not found' });
      return;
    }

    // Verify user is room owner
    if (!this.roomService.isRoomOwner(roomId, session.userId)) {
      socket.emit('membership_error', { message: 'Only room owner can approve members' });
      return;
    }

    const { userId: targetUserId } = data;

    // Check if user is in pending members
    const pendingUser = room.pendingMembers.get(targetUserId);
    if (!pendingUser) {
      socket.emit('membership_error', {
        message: 'User is not in pending members',
        userId: targetUserId
      });
      return;
    }

    // Approve the user
    const approvedUser = this.roomService.approveMember(roomId, targetUserId);
    if (!approvedUser) {
      socket.emit('membership_error', {
        message: 'Failed to approve member',
        userId: targetUserId
      });
      return;
    }

    // Get room namespace for broadcasting
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      // Notify all users in room about the new member
      roomNamespace.emit('user_joined', { user: approvedUser });

      // Send updated room state
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(roomId),
          pendingMembers: this.roomService.getPendingMembers(roomId)
        }
      };
      roomNamespace.emit('room_state_updated', updatedRoomData);
    }

    // Confirm to room owner
    socket.emit('member_approved', {
      message: 'Member approved successfully',
      userId: targetUserId,
      username: approvedUser.username
    });

    loggingService.logInfo('Member approved', {
      roomId,
      ownerId: session.userId,
      approvedUserId: targetUserId,
      approvedUsername: approvedUser.username
    });
  }

  /**
   * Handle member rejection - rejects a pending member from joining the room
   * Requirements: 4.1, 4.6
   */
  handleRejectMember(socket: Socket, data: { userId: string; roomId?: string; message?: string }): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('membership_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = data.roomId || session.roomId;
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('membership_error', { message: 'Room not found' });
      return;
    }

    // Verify user is room owner
    if (!this.roomService.isRoomOwner(roomId, session.userId)) {
      socket.emit('membership_error', { message: 'Only room owner can reject members' });
      return;
    }

    const { userId: targetUserId, message } = data;

    // Check if user is in pending members
    const pendingUser = room.pendingMembers.get(targetUserId);
    if (!pendingUser) {
      socket.emit('membership_error', {
        message: 'User is not in pending members',
        userId: targetUserId
      });
      return;
    }

    // Reject the user
    const rejectedUser = this.roomService.rejectMember(roomId, targetUserId);
    if (!rejectedUser) {
      socket.emit('membership_error', {
        message: 'Failed to reject member',
        userId: targetUserId
      });
      return;
    }

    // Get room namespace for broadcasting
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      // Send updated room state to room users
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(roomId),
          pendingMembers: this.roomService.getPendingMembers(roomId)
        }
      };
      roomNamespace.emit('room_state_updated', updatedRoomData);
    }

    // Confirm to room owner
    socket.emit('member_rejected', {
      message: 'Member rejected successfully',
      userId: targetUserId,
      username: rejectedUser.username
    });

    loggingService.logInfo('Member rejected', {
      roomId,
      ownerId: session.userId,
      rejectedUserId: targetUserId,
      rejectedUsername: rejectedUser.username,
      reason: message || 'No reason provided'
    });
  }

  /**
   * Handle member approval through namespace - namespace-aware version
   * Requirements: 4.1, 4.6
   */
  handleApproveMemberNamespace(socket: Socket, data: { userId: string; roomId?: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('membership_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = data.roomId || session.roomId;
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('membership_error', { message: 'Room not found' });
      return;
    }

    // Verify user is room owner
    if (!this.roomService.isRoomOwner(roomId, session.userId)) {
      socket.emit('membership_error', { message: 'Only room owner can approve members' });
      return;
    }

    const { userId: targetUserId } = data;

    // Check if user is in pending members
    const pendingUser = room.pendingMembers.get(targetUserId);
    if (!pendingUser) {
      socket.emit('membership_error', {
        message: 'User is not in pending members',
        userId: targetUserId
      });
      return;
    }

    // Approve the user
    const approvedUser = this.roomService.approveMember(roomId, targetUserId);
    if (!approvedUser) {
      socket.emit('membership_error', {
        message: 'Failed to approve member',
        userId: targetUserId
      });
      return;
    }

    // Notify all users in namespace about the new member
    namespace.emit('user_joined', { user: approvedUser });

    // Send updated room state through namespace
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(roomId),
        pendingMembers: this.roomService.getPendingMembers(roomId)
      }
    };
    namespace.emit('room_state_updated', updatedRoomData);

    // Confirm to room owner
    socket.emit('member_approved', {
      message: 'Member approved successfully',
      userId: targetUserId,
      username: approvedUser.username
    });

    loggingService.logInfo('Member approved via namespace', {
      roomId,
      ownerId: session.userId,
      approvedUserId: targetUserId,
      approvedUsername: approvedUser.username,
      namespaceName: namespace.name
    });
  }

  /**
   * Handle member rejection through namespace - namespace-aware version
   * Requirements: 4.1, 4.6
   */
  handleRejectMemberNamespace(socket: Socket, data: { userId: string; roomId?: string; message?: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('membership_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = data.roomId || session.roomId;
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('membership_error', { message: 'Room not found' });
      return;
    }

    // Verify user is room owner
    if (!this.roomService.isRoomOwner(roomId, session.userId)) {
      socket.emit('membership_error', { message: 'Only room owner can reject members' });
      return;
    }

    const { userId: targetUserId, message } = data;

    // Check if user is in pending members
    const pendingUser = room.pendingMembers.get(targetUserId);
    if (!pendingUser) {
      socket.emit('membership_error', {
        message: 'User is not in pending members',
        userId: targetUserId
      });
      return;
    }

    // Reject the user
    const rejectedUser = this.roomService.rejectMember(roomId, targetUserId);
    if (!rejectedUser) {
      socket.emit('membership_error', {
        message: 'Failed to reject member',
        userId: targetUserId
      });
      return;
    }

    // Send updated room state through namespace
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(roomId),
        pendingMembers: this.roomService.getPendingMembers(roomId)
      }
    };
    namespace.emit('room_state_updated', updatedRoomData);

    // Confirm to room owner
    socket.emit('member_rejected', {
      message: 'Member rejected successfully',
      userId: targetUserId,
      username: rejectedUser.username
    });

    loggingService.logInfo('Member rejected via namespace', {
      roomId,
      ownerId: session.userId,
      rejectedUserId: targetUserId,
      rejectedUsername: rejectedUser.username,
      reason: message || 'No reason provided',
      namespaceName: namespace.name
    });
  }

  /**
   * Get pending members for a room
   * Requirements: 4.1
   */
  getPendingMembers(roomId: string): User[] {
    return this.roomService.getPendingMembers(roomId);
  }

  /**
   * Check if a user is a pending member
   * Requirements: 4.1
   */
  isPendingMember(roomId: string, userId: string): boolean {
    const room = this.roomService.getRoom(roomId);
    return room ? room.pendingMembers.has(userId) : false;
  }

  /**
   * Get member count for a room (approved members only)
   * Requirements: 4.1
   */
  getMemberCount(roomId: string): number {
    const room = this.roomService.getRoom(roomId);
    return room ? room.users.size : 0;
  }

  /**
   * Get pending member count for a room
   * Requirements: 4.1
   */
  getPendingMemberCount(roomId: string): number {
    const room = this.roomService.getRoom(roomId);
    return room ? room.pendingMembers.size : 0;
  }

  /**
   * Handle ownership transfer - transfers room ownership to another member
   * Requirements: 4.1, 4.6
   */
  handleTransferOwnership(socket: Socket, data: TransferOwnershipData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('ownership_error', { message: 'You are not in a room' });
      return;
    }

    const result = this.roomService.transferOwnership(session.roomId, data.newOwnerId);
    if (!result) {
      socket.emit('ownership_error', { message: 'Failed to transfer ownership' });
      return;
    }

    // Get room namespace for broadcasting
    const roomNamespace = this.namespaceManager.getRoomNamespace(session.roomId);
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

    loggingService.logInfo('Ownership transferred', {
      roomId: session.roomId,
      oldOwnerId: result.oldOwner.id,
      newOwnerId: result.newOwner.id
    });
  }

  /**
   * Handle ownership transfer through namespace - namespace-aware version
   * Requirements: 4.1, 4.6
   */
  handleTransferOwnershipNamespace(socket: Socket, data: TransferOwnershipData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('ownership_error', { message: 'You are not in a room' });
      return;
    }

    const result = this.roomService.transferOwnership(session.roomId, data.newOwnerId);
    if (!result) {
      socket.emit('ownership_error', { message: 'Failed to transfer ownership' });
      return;
    }

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

    loggingService.logInfo('Ownership transferred via namespace', {
      roomId: session.roomId,
      oldOwnerId: result.oldOwner.id,
      newOwnerId: result.newOwner.id,
      namespaceName: namespace.name
    });
  }
}