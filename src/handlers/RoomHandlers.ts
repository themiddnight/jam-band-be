import { Request, Response } from 'express';
import { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../services/RoomService';
import { MetronomeService } from '../services/MetronomeService';
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
  MetronomeTickData
} from '../types';

export class RoomHandlers {
  private messageQueue = new Map<string, Array<{ event: string; data: any; timestamp: number }>>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_QUEUE_SIZE = 50;
  private voiceParticipants = new Map<string, Map<string, VoiceParticipantInfo>>(); // roomId -> userId -> info
  private metronomeService: MetronomeService;
  
  constructor(private roomService: RoomService, private io: Server) {
    this.metronomeService = MetronomeService.getInstance(io, roomService);
  }

  // Batch message processing for better performance
  private processBatch(roomId: string): void {
    const queue = this.messageQueue.get(roomId);
    if (!queue || queue.length === 0) return;

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

    // Process each group, sending only the latest message per group
    Object.entries(groupedMessages).forEach(([key, dataArray]) => {
      const latestData = dataArray[dataArray.length - 1];
      const [event] = key.split('-');
      if (event) {
        this.io.to(roomId).emit(event, latestData);
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

  // Optimized emit function that uses batching for non-critical events
  private optimizedEmit(socket: Socket, roomId: string, event: string, data: any, immediate: boolean = false): void {
    if (immediate || event === 'note_played' || event === 'user_joined' || event === 'user_left') {
      // Critical events are sent immediately, excluding the sender
      socket.to(roomId).emit(event, data);
    } else {
      // Other events are batched for better performance
      this.queueMessage(roomId, event, data);
    }
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
    // First, notify all users that the owner is leaving
    this.io.to(roomId).emit('user_left', { user: leavingUser });

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomId)) {
      this.io.to(roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
      this.metronomeService.cleanupRoom(roomId);
      this.roomService.deleteRoom(roomId);
      
      // Broadcast to all clients that the room was closed
      this.io.emit('room_closed_broadcast', { roomId });
      return;
    }

    // Try to transfer ownership to any remaining user
    const newOwner = this.roomService.getAnyUserInRoom(roomId);
    if (newOwner) {
      const result = this.roomService.transferOwnership(roomId, newOwner.id, oldOwner);
      if (result) {
        this.io.to(roomId).emit('ownership_transferred', {
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
          this.io.to(roomId).emit('room_state_updated', updatedRoomData);
        }
      }
    }
  }

  // Handle delayed ownership transfer for unintentional disconnects
  private handleDelayedOwnershipTransfer(roomId: string, oldOwner: any): void {
    const room = this.roomService.getRoom(roomId);
    if (!room) return;

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomId)) {
      this.io.to(roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
      this.metronomeService.cleanupRoom(roomId);
      this.roomService.deleteRoom(roomId);
      
      // Broadcast to all clients that the room was closed
      this.io.emit('room_closed_broadcast', { roomId });
      return;
    }

    // Try to transfer ownership to any remaining user
    const newOwner = this.roomService.getAnyUserInRoom(roomId);
    if (newOwner) {
      const result = this.roomService.transferOwnership(roomId, newOwner.id, oldOwner);
      if (result) {
        this.io.to(roomId).emit('ownership_transferred', {
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
        this.io.to(roomId).emit('room_state_updated', updatedRoomData);
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
        this.io.to(roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
        this.metronomeService.cleanupRoom(roomId);
        this.roomService.deleteRoom(roomId);
        
        // Broadcast to all clients that the room was closed
        this.io.emit('room_closed_broadcast', { roomId });
      } else {
        // Notify others about user leaving
        this.io.to(roomId).emit('user_left', { user });
        
        // Send updated room state to all users to ensure UI consistency
        const updatedRoomData = {
          room: {
            ...room,
            users: this.roomService.getRoomUsers(roomId),
            pendingMembers: this.roomService.getPendingMembers(roomId)
          }
        };
        this.io.to(roomId).emit('room_state_updated', updatedRoomData);
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
      this.roomService.removeFromGracePeriod(userId);
    } else if (isInGracePeriod) {
      // User is in grace period, restore them to the room
      const graceEntry = this.roomService['gracePeriodUsers'].get(userId);
      if (graceEntry) {
        // Restore user with their original role and data
        user = {
          ...graceEntry.userData,
          username, // Update username in case it changed
        };
        this.roomService.removeFromGracePeriod(userId);
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
    this.roomService.setUserSession(socket.id, session);
    
    // Remove old sessions for this user
    this.roomService.removeOldSessionsForUser(userId, socket.id);

    if (existingUser) {
      // User already exists in room, join them directly (e.g., page refresh)
      socket.join(roomId);
      
      // Notify others in room about the rejoin
      socket.to(roomId).emit('user_joined', { user });
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
      this.io.to(roomId).emit('room_state_updated', updatedRoomData);
    } else if (isInGracePeriod) {
      // User is in grace period (disconnected, not intentionally left), restore them to the room
      this.roomService.addUserToRoom(roomId, user);
      this.roomService.removeFromGracePeriod(userId);
      
      socket.join(roomId);
      
      // Notify others in room about the rejoin
      socket.to(roomId).emit('user_joined', { user });
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
      this.io.to(roomId).emit('room_state_updated', updatedRoomData);
    } else if (role === 'band_member' && room.isPrivate) {
      // Requesting to join as band member in a private room - needs owner approval
      this.roomService.addPendingMember(roomId, user);

      socket.emit('pending_approval', { message: 'Waiting for room owner approval' });

      // Notify room owner
      const ownerSocketId = this.roomService.findSocketByUserId(room.owner);
      if (ownerSocketId) {
        const ownerSocket = this.io.sockets.sockets.get(ownerSocketId);
        if (ownerSocket) {
          ownerSocket.emit('member_request', { user });
        }
      }
    } else {
      // New audience member or band member in public room - join directly
      this.roomService.addUserToRoom(roomId, user);
      
      socket.join(roomId);
      
      // Notify others in room
      socket.to(roomId).emit('user_joined', { user });
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
      this.io.to(roomId).emit('room_state_updated', updatedRoomData);
    }
  }

  handleApproveMember(socket: Socket, data: ApproveMemberData): void {
    const session = this.roomService.getUserSession(socket.id);
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
    const approvedSocketId = this.roomService.findSocketByUserId(data.userId);
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

    // Notify all users in room about the new member (including the approver)
    this.io.to(session.roomId).emit('user_joined', { user: approvedUser });
    
    // Send updated room state to all users to ensure UI consistency
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(session.roomId),
        pendingMembers: this.roomService.getPendingMembers(session.roomId)
      }
    };
    this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
  }

  handleRejectMember(socket: Socket, data: RejectMemberData): void {
    const session = this.roomService.getUserSession(socket.id);
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
    const rejectedSocketId = this.roomService.findSocketByUserId(data.userId);
    if (rejectedSocketId) {
      const rejectedSocket = this.io.sockets.sockets.get(rejectedSocketId);
      if (rejectedSocket) {
        // Send rejection message - the frontend will handle disconnection
        rejectedSocket.emit('member_rejected', { message: 'Your request was rejected', userId: data.userId });
      }
    }

    // Send updated room state to all users in the room (excluding the rejected user)
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(session.roomId),
        pendingMembers: this.roomService.getPendingMembers(session.roomId)
      }
    };
    this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
  }

  handlePlayNote(socket: Socket, data: PlayNoteData): void {
    const session = this.roomService.getUserSession(socket.id);
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
    const session = this.roomService.getUserSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    this.roomService.updateUserInstrument(session.roomId, session.userId, data.instrument, data.category);

    // Use optimized emit for better performance
    this.optimizedEmit(socket, session.roomId, 'instrument_changed', {
      userId: session.userId,
      username: user.username,
      instrument: data.instrument,
      category: data.category
    }, true); // Instrument changes are important and sent immediately
    
    // Send updated room state to all users to ensure UI consistency
    const updatedRoomData = {
      room: {
        ...room,
        users: this.roomService.getRoomUsers(session.roomId),
        pendingMembers: this.roomService.getPendingMembers(session.roomId)
      }
    };
    this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
  }

  handleUpdateSynthParams(socket: Socket, data: UpdateSynthParamsData): void {
    const session = this.roomService.getUserSession(socket.id);
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
    const session = this.roomService.getUserSession(socket.id);
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
      const synthUserSocketId = this.roomService.findSocketByUserId(synthUser.id);
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

  handleTransferOwnership(socket: Socket, data: TransferOwnershipData): void {
    const session = this.roomService.getUserSession(socket.id);
    if (!session) return;

    const result = this.roomService.transferOwnership(session.roomId, data.newOwnerId);
    if (!result) return;

    // Notify all users in room
    this.io.to(session.roomId).emit('ownership_transferred', {
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
      this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
    }
  }

  handleLeaveRoom(socket: Socket, isIntendedLeave: boolean = false): void {
    const session = this.roomService.getUserSession(socket.id);
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
      
      // Send updated room state to all users in the room to remove the pending member
      const updatedRoomData = {
        room: {
          ...room,
          users: this.roomService.getRoomUsers(session.roomId),
          pendingMembers: this.roomService.getPendingMembers(session.roomId)
        }
      };
      this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
      
      this.roomService.removeUserSession(socket.id);
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
        this.io.to(session.roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
        this.metronomeService.cleanupRoom(session.roomId);
        this.roomService.deleteRoom(session.roomId);
        
        // Broadcast to all clients that the room was closed
        this.io.emit('room_closed_broadcast', { roomId: session.roomId });
      } else {
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
        this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
      }
    }

    socket.leave(session.roomId);
    this.roomService.removeUserSession(socket.id);
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
    this.roomService.setUserSession(socket.id, session);

    // Start metronome for the new room
    this.metronomeService.initializeRoomMetronome(room.id);

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
    const session = this.roomService.getUserSession(socket.id);
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
          this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
          
          this.roomService.removeUserSession(socket.id);
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
              this.io.to(session.roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
              this.metronomeService.cleanupRoom(session.roomId);
              this.roomService.deleteRoom(session.roomId);
              
              // Broadcast to all clients that the room was closed
              this.io.emit('room_closed_broadcast', { roomId: session.roomId });
            } else {
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
              this.io.to(session.roomId).emit('room_state_updated', updatedRoomData);
            }
          }
        }
      }
      this.roomService.removeUserSession(socket.id);
    }
  }

  // WebRTC Voice Communication Handlers - Full Mesh Network Support
  handleVoiceOffer(socket: Socket, data: VoiceOfferData): void {
    const session = this.roomService.getUserSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid offer: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    const user = this.roomService.findUserInRoom(session.roomId, session.userId);
    const username = user?.username || 'Unknown';

    console.log(`[MESH] Offer from ${session.userId} to ${data.targetUserId} in room ${data.roomId}`);
    
    // In a full mesh network, forward the offer directly to the specific target user
    // Find the target user's socket
    const targetSocketId = this.roomService.findSocketByUserId(data.targetUserId);
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
    const session = this.roomService.getUserSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid answer: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    console.log(`[MESH] Answer from ${session.userId} to ${data.targetUserId} in room ${data.roomId}`);
    
    // Direct delivery to specific target user for mesh networking
    const targetSocketId = this.roomService.findSocketByUserId(data.targetUserId);
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
    const session = this.roomService.getUserSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      return;
    }

    // Direct ICE candidate delivery for mesh networking efficiency
    const targetSocketId = this.roomService.findSocketByUserId(data.targetUserId);
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
    const session = this.roomService.getUserSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[VOICE] Invalid join voice: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    console.log(`[MESH] User ${data.username} (${data.userId}) joined voice in room ${data.roomId}`);
    
    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const existingParticipants = Array.from(voiceRoomMap.entries());
    
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
    console.log(`[MESH] Existing participants notified:`, existingParticipants.map(([id, info]) => `${info.username}(${id})`));
  }

  // Mesh connection coordination - ensures proper full mesh establishment
  handleRequestMeshConnections(socket: Socket, data: { roomId: string; userId: string }): void {
    const session = this.roomService.getUserSession(socket.id);
    if (!session || session.roomId !== data.roomId) {
      console.warn(`[MESH] Invalid mesh request: socket ${socket.id} not in room ${data.roomId}`);
      return;
    }

    const voiceRoomMap = this.getVoiceRoomMap(data.roomId);
    const allParticipants = Array.from(voiceRoomMap.values());
    const otherParticipants = allParticipants.filter(p => p.userId !== data.userId);

    console.log(`[MESH] Connection request from ${data.userId}. Other participants:`, 
      otherParticipants.map(p => p.userId));

    // For full mesh: respond with all other participants this user should connect to
    socket.emit('mesh_participants', {
      participants: otherParticipants.map(p => ({
        userId: p.userId,
        username: p.username,
        isMuted: p.isMuted,
        // Deterministic connection initiation based on lexicographical comparison
        shouldInitiate: data.userId.localeCompare(p.userId) < 0
      }))
    });

    // Notify each existing participant about the new user they should connect to
    otherParticipants.forEach(participant => {
      const participantSocketId = this.roomService.findSocketByUserId(participant.userId);
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
    const session = this.roomService.getUserSession(socket.id);
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
    const session = this.roomService.getUserSession(socket.id);
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
    const session = this.roomService.getUserSession(socket.id);
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
        const targetSocketId = this.roomService.findSocketByUserId(targetUserId);
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
    const session = this.roomService.getUserSession(socket.id);
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
      staleUsers.forEach(userId => {
        voiceMap.delete(userId);
        this.io.to(roomId).emit('user_left_voice', { userId });
      });

      // Remove empty voice rooms
      if (voiceMap.size === 0) {
        this.voiceParticipants.delete(roomId); // Changed from this.voiceRooms to this.voiceParticipants
      }
    }
  }

  // Chat Message Handler
  handleChatMessage(socket: Socket, data: ChatMessageData): void {
    const session = this.roomService.getUserSession(socket.id);
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

    // Broadcast chat message to all users in the room
    this.io.to(roomId).emit('chat_message', chatMessage);
  }

  // Metronome handlers
  handleUpdateMetronome(socket: Socket, data: UpdateMetronomeData): void {
    const session = this.roomService.getUserSession(socket.id);
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

    // Broadcast metronome state to all users in the room
    this.io.to(session.roomId).emit('metronome_updated', {
      bpm: updatedRoom.metronome.bpm,
      lastTickTimestamp: updatedRoom.metronome.lastTickTimestamp
    });
  }

  handleRequestMetronomeState(socket: Socket): void {
    const session = this.roomService.getUserSession(socket.id);
    if (!session) return;

    const metronomeState = this.roomService.getMetronomeState(session.roomId);
    if (!metronomeState) return;

    // Send current metronome state to the requesting user
    socket.emit('metronome_state', metronomeState);
  }
} 