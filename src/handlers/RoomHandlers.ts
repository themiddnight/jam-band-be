import { Request, Response } from 'express';
import { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../services/RoomService';
import { 
  JoinRoomData, 
  CreateRoomData, 
  ApproveMemberData, 
  RejectMemberData,
  PlayNoteData,
  ChangeInstrumentData,
  UpdateSynthParamsData,
  TransferOwnershipData,
  User
} from '../types';

export class RoomHandlers {
  private messageQueue = new Map<string, Array<{ event: string; data: any; timestamp: number }>>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_QUEUE_SIZE = 50;

  constructor(private roomService: RoomService, private io: Server) {}

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
  private handleRoomOwnerLeaving(roomId: string, leavingUserId: string): void {
    const room = this.roomService.getRoom(roomId);
    if (!room) return;

    const leavingUser = room.users.get(leavingUserId);
    if (!leavingUser) return;

    // First, notify all users that the owner is leaving
    this.io.to(roomId).emit('user_left', { user: leavingUser });

    // Store the old owner information before removing them
    const oldOwner = { ...leavingUser };

    // Remove the leaving user from room
    this.roomService.removeUserFromRoom(roomId, leavingUserId);

    // Check if room should be closed (no users left)
    if (this.roomService.shouldCloseRoom(roomId)) {
      this.io.to(roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
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
      }
    }
  }

  // HTTP Handlers
  getHealthCheck(req: Request, res: Response): void {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  getRoomList(req: Request, res: Response): void {
    const roomList = this.roomService.getAllRooms();
    res.json(roomList);
  }

  // Socket Event Handlers
  handleJoinRoom(socket: Socket, data: JoinRoomData): void {
    const { roomId, username, role } = data;
    
    const room = this.roomService.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    
    // Check if user already exists in the room
    const existingUser = this.roomService.findUserInRoom(roomId, username);
    let userId: string;
    let user: User;
    
    if (existingUser) {
      // User already exists in room, use existing user data
      userId = existingUser.id;
      user = existingUser;
    } else {
      // Create new user
      userId = uuidv4();
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
      // User already exists in room, join them directly
      socket.join(roomId);
      
      // Notify others in room about the rejoin
      socket.to(roomId).emit('user_joined', { user });
      socket.emit('room_joined', { 
        room, 
        users: this.roomService.getRoomUsers(roomId),
        pendingMembers: this.roomService.getPendingMembers(roomId),

      });
    } else if (role === 'band_member') {
      // New user requesting to join as band member - needs approval
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
      // New audience member - join directly
      this.roomService.addUserToRoom(roomId, user);
      
      socket.join(roomId);
      
      // Notify others in room
      socket.to(roomId).emit('user_joined', { user });
      socket.emit('room_joined', { 
        room, 
        users: this.roomService.getRoomUsers(roomId),
        pendingMembers: this.roomService.getPendingMembers(roomId)
      });
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
        rejectedSocket.emit('member_rejected', { message: 'Your request was rejected', userId: data.userId });
      }
    }

    // Notify room owner to remove the pending member from their view
    const ownerSocketId = this.roomService.findSocketByUserId(room.owner);
    if (ownerSocketId) {
      const ownerSocket = this.io.sockets.sockets.get(ownerSocketId);
      if (ownerSocket) {
        ownerSocket.emit('pending_member_cancelled', { userId: data.userId });
      }
    }
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
  }

  handleUpdateSynthParams(socket: Socket, data: UpdateSynthParamsData): void {
    const session = this.roomService.getUserSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Use optimized emit for better performance - synth params can be batched
    this.optimizedEmit(socket, session.roomId, 'synth_params_changed', {
      userId: session.userId,
      username: user.username,
      instrument: user.currentInstrument || '',
      category: user.currentCategory || '',
      params: data.params
    }, false); // Synth params can be batched for better performance
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
  }

  handleLeaveRoom(socket: Socket): void {
    const session = this.roomService.getUserSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    const pendingUser = room.pendingMembers.get(session.userId);
    
    // Check if this was a pending member who cancelled
    if (pendingUser) {
      this.roomService.rejectMember(session.roomId, session.userId);
      
      // Notify room owner to clear the acceptance prompt
      const ownerSocketId = this.roomService.findSocketByUserId(room.owner);
      if (ownerSocketId) {
        const ownerSocket = this.io.sockets.sockets.get(ownerSocketId);
        if (ownerSocket) {
          ownerSocket.emit('pending_member_cancelled', { userId: session.userId });
        }
      }
      
      this.roomService.removeUserSession(socket.id);
      return;
    }

    if (!user) return;

    // If room owner leaves, handle ownership transfer or room closure
    if (user.role === 'room_owner') {
      this.handleRoomOwnerLeaving(session.roomId, session.userId);
    } else {
      // Regular user leaving - just remove them from room
      this.roomService.removeUserFromRoom(session.roomId, session.userId);
      
      // Check if room should be closed after regular user leaves
      if (this.roomService.shouldCloseRoom(session.roomId)) {
        this.io.to(session.roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
        this.roomService.deleteRoom(session.roomId);
        
        // Broadcast to all clients that the room was closed
        this.io.emit('room_closed_broadcast', { roomId: session.roomId });
      } else {
        // Notify others about user leaving
        socket.to(session.roomId).emit('user_left', { user });
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
    
    const { room, user, session } = this.roomService.createRoom(data.name, data.username);

    socket.join(room.id);
    socket.data = session;
    this.roomService.setUserSession(socket.id, session);

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
      createdAt: room.createdAt.toISOString()
    });
  }

  handleDisconnect(socket: Socket): void {
    const session = this.roomService.getUserSession(socket.id);
    if (session) {
      const room = this.roomService.getRoom(session.roomId);
      if (room) {
        const user = room.users.get(session.userId);
        if (user) {
          // Handle room owner disconnection
          if (user.role === 'room_owner') {
            this.handleRoomOwnerLeaving(session.roomId, session.userId);
          } else {
            // Regular user disconnection
            this.roomService.removeUserFromRoom(session.roomId, session.userId);
            
            // Check if room should be closed after user disconnects
            if (this.roomService.shouldCloseRoom(session.roomId)) {
              this.io.to(session.roomId).emit('room_closed', { message: 'Room is empty and has been closed' });
              this.roomService.deleteRoom(session.roomId);
              
              // Broadcast to all clients that the room was closed
              this.io.emit('room_closed_broadcast', { roomId: session.roomId });
            } else {
              // Notify others about user disconnection
              socket.to(session.roomId).emit('user_left', { user });
            }
          }
        }
      }
      this.roomService.removeUserSession(socket.id);
    }
  }
} 