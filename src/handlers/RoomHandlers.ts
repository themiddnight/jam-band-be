import { Request, Response } from 'express';
import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../services/RoomService';
import { MetronomeService } from '../services/MetronomeService';
import { NamespaceManager } from '../services/NamespaceManager';
import { RoomSessionManager } from '../services/RoomSessionManager';

import { RoomLifecycleHandler } from './RoomLifecycleHandler';
import { VoiceConnectionHandler } from './VoiceConnectionHandler';
import { AudioRoutingHandler } from './AudioRoutingHandler';
import { RoomMembershipHandler } from './RoomMembershipHandler';

import { getHealthCheckData } from '../middleware/monitoring';
import {
  JoinRoomData,
  PlayNoteData,
  ChangeInstrumentData,
  UpdateSynthParamsData,
  TransferOwnershipData,
  ChatMessageData,
  ChatMessage,
  UpdateMetronomeData,
} from '../types';

export class RoomHandlers {
  private messageQueue = new Map<string, Array<{ event: string; data: any; timestamp: number }>>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_QUEUE_SIZE = 50;
  private metronomeService: MetronomeService;
  private voiceConnectionHandler: VoiceConnectionHandler;
  private audioRoutingHandler: AudioRoutingHandler;
  private roomMembershipHandler: RoomMembershipHandler;


  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager,
    private roomLifecycleHandler?: RoomLifecycleHandler,
    voiceConnectionHandler?: VoiceConnectionHandler,
    audioRoutingHandler?: AudioRoutingHandler,
    roomMembershipHandler?: RoomMembershipHandler
  ) {
    this.metronomeService = new MetronomeService(io, roomService);
    this.voiceConnectionHandler = voiceConnectionHandler || new VoiceConnectionHandler(roomService, io, roomSessionManager);
    this.audioRoutingHandler = audioRoutingHandler || new AudioRoutingHandler(roomService, io, roomSessionManager, namespaceManager);
    this.roomMembershipHandler = roomMembershipHandler || new RoomMembershipHandler(roomService, io, namespaceManager, roomSessionManager);
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
    if (this.roomLifecycleHandler) {
      return this.roomLifecycleHandler.handleCreateRoomHttp(req, res);
    }

    // Lifecycle handler is required
    res.status(500).json({
      success: false,
      message: 'Room lifecycle handler not available'
    });
  }

  handleLeaveRoomHttp(req: Request, res: Response): void {
    if (this.roomLifecycleHandler) {
      return this.roomLifecycleHandler.handleLeaveRoomHttp(req, res);
    }

    // Lifecycle handler is required
    res.status(500).json({
      success: false,
      message: 'Room lifecycle handler not available'
    });
  }

  // Socket Event Handlers




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
    this.audioRoutingHandler.handleUpdateSynthParams(socket, data);
  }

  handleRequestSynthParams(socket: Socket): void {
    this.audioRoutingHandler.handleRequestSynthParams(socket);
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
          // Use lifecycle handler for all disconnections
          if (this.roomLifecycleHandler) {
            this.roomLifecycleHandler.handleLeaveRoom(socket, false);
          } else {
            // Fallback for regular user disconnection if lifecycle handler not available
            if (user.role !== 'room_owner') {
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
                this.voiceConnectionHandler.cleanupRoom(session.roomId);
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
      }
      this.roomSessionManager.removeSession(socket.id);
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

    // Call lifecycle handler directly
    if (this.roomLifecycleHandler) {
      this.roomLifecycleHandler.handleJoinRoom(socket, data);
    } else {
      socket.emit('error', { message: 'Room lifecycle handler not available' });
    }
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
    this.audioRoutingHandler.handleUpdateSynthParamsNamespace(socket, data, namespace);
  }

  /**
   * Handle request synth params through namespace - Requirements: 7.1, 7.2
   */
  handleRequestSynthParamsNamespace(socket: Socket, namespace: Namespace): void {
    this.audioRoutingHandler.handleRequestSynthParamsNamespace(socket, namespace);
  }

  /**
   * Handle auto-send synth params to new user through namespace
   */
  handleAutoSendSynthParamsToNewUserNamespace(socket: Socket, data: { newUserId: string; newUsername: string }, namespace: Namespace): void {
    // Delegate to audio routing handler for consistency
    // This method is kept for backward compatibility with existing namespace handlers
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const synthUser = room.users.get(session.userId);
    if (!synthUser || synthUser.currentCategory !== 'synthesizer') return;

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
    // Delegate to audio routing handler for consistency
    // This method is kept for backward compatibility with existing namespace handlers
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const synthUser = room.users.get(session.userId);
    if (!synthUser || synthUser.currentCategory !== 'synthesizer' || synthUser.id !== data.synthUserId) return;

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



  // ========================================


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

  // ========================================
  // MEMBER MANAGEMENT DELEGATION METHODS
  // Requirements: 4.1, 4.6
  // ========================================

  /**
   * Handle member approval - delegates to RoomMembershipHandler
   * Requirements: 4.1, 4.6
   */
  handleApproveMember(socket: Socket, data: { userId: string; roomId?: string }): void {
    this.roomMembershipHandler.handleApproveMember(socket, data);
  }

  /**
   * Handle member rejection - delegates to RoomMembershipHandler
   * Requirements: 4.1, 4.6
   */
  handleRejectMember(socket: Socket, data: { userId: string; roomId?: string; message?: string }): void {
    this.roomMembershipHandler.handleRejectMember(socket, data);
  }

  /**
   * Handle member approval through namespace - delegates to RoomMembershipHandler
   * Requirements: 4.1, 4.6
   */
  handleApproveMemberNamespace(socket: Socket, data: { userId: string; roomId?: string }, namespace: Namespace): void {
    this.roomMembershipHandler.handleApproveMemberNamespace(socket, data, namespace);
  }

  /**
   * Handle member rejection through namespace - delegates to RoomMembershipHandler
   * Requirements: 4.1, 4.6
   */
  handleRejectMemberNamespace(socket: Socket, data: { userId: string; roomId?: string; message?: string }, namespace: Namespace): void {
    this.roomMembershipHandler.handleRejectMemberNamespace(socket, data, namespace);
  }

} 