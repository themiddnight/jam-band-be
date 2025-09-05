import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { ApprovalSessionManager } from '../../../../services/ApprovalSessionManager';
import { loggingService } from '../../../../services/LoggingService';
import {
  ApprovalRequestData,
  ApprovalResponseData,
  ApprovalCancelData,
  ApprovalTimeoutData,
  User
} from '../../../../types';

/**
 * ApprovalWorkflowHandler - Handles private room join approval workflows
 * 
 * This handler manages the complete approval process for users requesting to join private rooms:
 * - Approval requests from users wanting to join
 * - Approval responses from room owners (approve/reject)
 * - Approval cancellations from waiting users
 * - Approval timeouts for expired requests
 * - Cleanup on disconnections
 * 
 * Requirements: 4.1, 4.6
 */
export class ApprovalWorkflowHandler {
  private approvalSessionManager: ApprovalSessionManager;

  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager,
    approvalSessionManager?: ApprovalSessionManager
  ) {
    this.approvalSessionManager = approvalSessionManager || new ApprovalSessionManager();
  }

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
}