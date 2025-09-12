import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { loggingService } from '../../../../services/LoggingService';

/**
 * InstrumentSwapHandler - Handles instrument swap and kick operations
 * 
 * This handler manages:
 * - Instrument swap requests between users
 * - Swap approval/rejection
 * - Swap execution and state synchronization
 * - User kick functionality (room owner only)
 * 
 * Requirements: User collaboration features
 */
export class InstrumentSwapHandler {
  // Track pending swap requests: requesterId -> targetUserId
  private pendingSwaps = new Map<string, string>();

  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager
  ) {}

  /**
   * Handle instrument swap request
   */
  handleRequestInstrumentSwap(socket: Socket, data: { targetUserId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('swap_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = session.roomId;
    const requesterId = session.userId;
    const { targetUserId } = data;

    // Validate target user exists in room
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('swap_error', { message: 'Room not found' });
      return;
    }

    const targetUser = room.users.get(targetUserId);
    const requesterUser = room.users.get(requesterId);
    
    if (!targetUser) {
      socket.emit('swap_error', { message: 'Target user not found in room' });
      return;
    }

    if (!requesterUser) {
      socket.emit('swap_error', { message: 'Requester not found in room' });
      return;
    }

    // Check if users can swap (not audience)
    if (targetUser.role === 'audience' || requesterUser.role === 'audience') {
      socket.emit('swap_error', { message: 'Cannot swap with audience members' });
      return;
    }

    // Check for existing pending swap
    if (this.pendingSwaps.has(requesterId)) {
      socket.emit('swap_error', { message: 'You already have a pending swap request' });
      return;
    }

    // Store pending swap
    this.pendingSwaps.set(requesterId, targetUserId);

    // Notify requester that request was sent
    socket.emit('swap_request_sent', { targetUserId });

    // Send swap request to target user
    const targetSocket = this.findSocketByUserId(targetUserId, namespace);
    if (targetSocket) {
      targetSocket.emit('swap_request_received', {
        requesterId,
        requesterUsername: requesterUser.username
      });
    }

    loggingService.logInfo('Instrument swap requested', {
      roomId,
      requesterId,
      targetUserId,
      requesterUsername: requesterUser.username,
      targetUsername: targetUser.username
    });
  }

  /**
   * Handle swap approval
   */
  handleApproveInstrumentSwap(socket: Socket, data: { requesterId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('swap_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = session.roomId;
    const targetUserId = session.userId;
    const { requesterId } = data;

    // Validate pending swap exists
    const pendingTargetId = this.pendingSwaps.get(requesterId);
    if (pendingTargetId !== targetUserId) {
      socket.emit('swap_error', { message: 'No pending swap request found' });
      return;
    }

    // Execute the swap
    this.executeSwap(requesterId, targetUserId, roomId, namespace);
  }

  /**
   * Handle swap rejection
   */
  handleRejectInstrumentSwap(socket: Socket, data: { requesterId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('swap_error', { message: 'You are not in a room' });
      return;
    }

    const { requesterId } = data;

    // Remove pending swap
    this.pendingSwaps.delete(requesterId);

    // Notify requester of rejection
    const requesterSocket = this.findSocketByUserId(requesterId, namespace);
    if (requesterSocket) {
      requesterSocket.emit('swap_rejected');
    }

    loggingService.logInfo('Instrument swap rejected', {
      roomId: session.roomId,
      requesterId,
      targetUserId: session.userId
    });
  }

  /**
   * Handle swap cancellation
   */
  handleCancelInstrumentSwap(socket: Socket, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('swap_error', { message: 'You are not in a room' });
      return;
    }

    const requesterId = session.userId;
    const targetUserId = this.pendingSwaps.get(requesterId);

    if (!targetUserId) {
      socket.emit('swap_error', { message: 'No pending swap request found' });
      return;
    }

    // Remove pending swap
    this.pendingSwaps.delete(requesterId);

    // Notify target user of cancellation
    const targetSocket = this.findSocketByUserId(targetUserId, namespace);
    if (targetSocket) {
      targetSocket.emit('swap_cancelled');
    }

    loggingService.logInfo('Instrument swap cancelled', {
      roomId: session.roomId,
      requesterId,
      targetUserId
    });
  }

  /**
   * Handle user kick (room owner only)
   */
  handleKickUser(socket: Socket, data: { targetUserId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('kick_error', { message: 'You are not in a room' });
      return;
    }

    const roomId = session.roomId;
    const ownerId = session.userId;
    const { targetUserId } = data;

    // Verify user is room owner
    if (!this.roomService.isRoomOwner(roomId, ownerId)) {
      socket.emit('kick_error', { message: 'Only room owner can kick users' });
      return;
    }

    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('kick_error', { message: 'Room not found' });
      return;
    }

    const targetUser = room.users.get(targetUserId);
    if (!targetUser) {
      socket.emit('kick_error', { message: 'Target user not found in room' });
      return;
    }

    // Cannot kick room owner
    if (targetUser.role === 'room_owner') {
      socket.emit('kick_error', { message: 'Cannot kick room owner' });
      return;
    }

    // Remove user from room
    this.roomService.removeUserFromRoom(roomId, targetUserId);

    // Notify kicked user
    const targetSocket = this.findSocketByUserId(targetUserId, namespace);
    if (targetSocket) {
      targetSocket.emit('user_kicked', { reason: 'Kicked by room owner' });
      targetSocket.leave(roomId);
    }

    // Notify all users in room about user leaving
    namespace.emit('user_left', { user: targetUser });

    // Send updated room state
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(roomId),
        pendingMembers: this.roomService.getPendingMembers(roomId)
      }
    };
    namespace.emit('room_state_updated', updatedRoomData);

    loggingService.logInfo('User kicked from room', {
      roomId,
      ownerId,
      kickedUserId: targetUserId,
      kickedUsername: targetUser.username
    });
  }

  /**
   * Execute the instrument swap between two users
   */
  private executeSwap(requesterId: string, targetUserId: string, roomId: string, namespace: Namespace): void {
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      return;
    }

    const requesterUser = room.users.get(requesterId);
    const targetUser = room.users.get(targetUserId);

    if (!requesterUser || !targetUser) {
      return;
    }

    // Capture current state snapshots
    const aInstrument = requesterUser.currentInstrument;
    const aCategory = requesterUser.currentCategory;
    const aSynthParams = requesterUser.synthParams;

    const bInstrument = targetUser.currentInstrument;
    const bCategory = targetUser.currentCategory;
    const bSynthParams = targetUser.synthParams;

    // Preconditions: instruments and categories must exist for both users
    if (!aInstrument || !aCategory || !bInstrument || !bCategory) {
      loggingService.logInfo('Instrument swap aborted due to missing instrument/category', {
        roomId,
        requesterId,
        targetUserId,
        aInstrument,
        aCategory,
        bInstrument,
        bCategory,
      });
      // Notify involved users
      const requesterSocket = this.findSocketByUserId(requesterId, namespace);
      const targetSocket = this.findSocketByUserId(targetUserId, namespace);
      requesterSocket?.emit('swap_error', { message: 'Swap failed: missing instrument/category' });
      targetSocket?.emit('swap_error', { message: 'Swap failed: missing instrument/category' });
      // Clear pending swap
      this.pendingSwaps.delete(requesterId);
      return;
    }

    const aIsSynth = aCategory === 'synthesizer';
    const bIsSynth = bCategory === 'synthesizer';

    // Perform instrument/category swap (non-null due to preconditions)
    requesterUser.currentInstrument = bInstrument!;
    requesterUser.currentCategory = bCategory!;

    targetUser.currentInstrument = aInstrument!;
    targetUser.currentCategory = aCategory!;

    // Apply synth params per rules
    // - If destination is synth, receiver gets source's synth params; otherwise clear
    if (bIsSynth && bSynthParams) {
      requesterUser.synthParams = bSynthParams;
    } else {
      delete requesterUser.synthParams;
    }

    if (aIsSynth && aSynthParams) {
      targetUser.synthParams = aSynthParams;
    } else {
      delete targetUser.synthParams;
    }

    // Persist new instruments/categories in room service
    this.roomService.updateUserInstrument(roomId, requesterId, requesterUser.currentInstrument, requesterUser.currentCategory);
    this.roomService.updateUserInstrument(roomId, targetUserId, targetUser.currentInstrument, targetUser.currentCategory);

    // Remove pending swap
    this.pendingSwaps.delete(requesterId);

    // Build swap payload with DESTINATION instruments and conditional synth params
    const swapData = {
      userA: {
        userId: requesterId,
        instrumentName: requesterUser.currentInstrument,
        category: requesterUser.currentCategory,
        synthParams: requesterUser.currentCategory === 'synthesizer' && requesterUser.synthParams ? requesterUser.synthParams : undefined,
      },
      userB: {
        userId: targetUserId,
        instrumentName: targetUser.currentInstrument,
        category: targetUser.currentCategory,
        synthParams: targetUser.currentCategory === 'synthesizer' && targetUser.synthParams ? targetUser.synthParams : undefined,
      }
    };

    // Notify all users in room about the swap
    namespace.emit('swap_completed', swapData);

    // ALSO broadcast standard instrument & synth param events so other clients update immediately
    // (Previously only swap_completed was emitted, causing other users to retain stale synth params
    // until an explicit instrument toggle occurred.)
    try {
      namespace.emit('instrument_changed', {
        userId: requesterId,
        username: requesterUser.username,
        instrument: requesterUser.currentInstrument,
        category: requesterUser.currentCategory
      });
      namespace.emit('instrument_changed', {
        userId: targetUserId,
        username: targetUser.username,
        instrument: targetUser.currentInstrument,
        category: targetUser.currentCategory
      });

      if (requesterUser.currentCategory === 'synthesizer' && requesterUser.synthParams) {
        namespace.emit('synth_params_changed', {
          userId: requesterId,
          username: requesterUser.username,
            instrument: requesterUser.currentInstrument,
          category: requesterUser.currentCategory,
          params: requesterUser.synthParams
        });
      }
      if (targetUser.currentCategory === 'synthesizer' && targetUser.synthParams) {
        namespace.emit('synth_params_changed', {
          userId: targetUserId,
          username: targetUser.username,
          instrument: targetUser.currentInstrument,
          category: targetUser.currentCategory,
          params: targetUser.synthParams
        });
      }
    } catch (broadcastErr) {
      loggingService.logError(broadcastErr instanceof Error ? broadcastErr : new Error('Unknown broadcast error'), {
        context: 'InstrumentSwapHandler.executeSwap.broadcasts',
        roomId,
        requesterId,
        targetUserId
      });
    }

    loggingService.logInfo('Instrument swap completed', {
      roomId,
      requesterId,
      targetUserId,
      swapData
    });
  }

  /**
   * Find socket by user ID in namespace
   */
  private findSocketByUserId(userId: string, namespace: Namespace): Socket | null {
    for (const [socketId, socket] of namespace.sockets) {
      const session = this.roomSessionManager.getRoomSession(socketId);
      if (session && session.userId === userId) {
        return socket;
      }
    }
    return null;
  }

  /**
   * Clean up pending swaps when user disconnects
   */
  handleUserDisconnect(userId: string, namespace: Namespace): void {
    // Remove any pending swap requests from this user
    this.pendingSwaps.delete(userId);

    // Cancel any pending swaps targeting this user
    for (const [requesterId, targetId] of this.pendingSwaps.entries()) {
      if (targetId === userId) {
        this.pendingSwaps.delete(requesterId);
        
        // Notify requester that target user disconnected
        const requesterSocket = this.findSocketByUserId(requesterId, namespace);
        if (requesterSocket) {
          requesterSocket.emit('swap_cancelled');
        }
      }
    }
  }

  /**
   * Handle request for sequencer state from another user
   */
  handleRequestSequencerState(socket: Socket, data: { targetUserId: string }, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('sequencer_error', { message: 'You are not in a room' });
      return;
    }

    const targetSocket = this.findSocketByUserId(data.targetUserId, namespace);
    if (!targetSocket) {
      socket.emit('sequencer_error', { message: 'Target user not found' });
      return;
    }

    // Forward the request to target user (frontend listens to 'sequencer_state_requested')
    targetSocket.emit('sequencer_state_requested', { requesterId: session.userId });
  }

  /**
   * Handle sending sequencer state snapshot to another user
   */
  handleSendSequencerState(
    socket: Socket,
    data: { targetUserId: string; snapshot: { banks: any; settings: any; currentBank: string } },
    namespace: Namespace
  ): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) {
      socket.emit('sequencer_error', { message: 'You are not in a room' });
      return;
    }

    const targetSocket = this.findSocketByUserId(data.targetUserId, namespace);
    if (!targetSocket) {
      socket.emit('sequencer_error', { message: 'Target user not found' });
      return;
    }

    // Forward the snapshot to the target user (frontend listens to 'sequencer_state')
    targetSocket.emit('sequencer_state', {
      fromUserId: session.userId,
      snapshot: data.snapshot,
    });
  }
} 