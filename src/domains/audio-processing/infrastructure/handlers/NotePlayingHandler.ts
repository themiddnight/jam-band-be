import { Socket, Namespace } from 'socket.io';
import { Server } from 'socket.io';

import { RoomService } from '../../../../services/RoomService';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';

import {
  PlayNoteData,
  ChangeInstrumentData,
} from '../../../../types';

export class NotePlayingHandler {
  private messageQueue = new Map<string, Array<{ event: string; data: any; timestamp: number }>>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_QUEUE_SIZE = 50;

  constructor(
    private roomService: RoomService,
    private io: Server,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager
  ) {}

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

  /**
   * Handle play note event
   * Requirements: 4.1, 4.6
   */
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

  /**
   * Handle change instrument event
   * Requirements: 4.1, 4.6
   */
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

  /**
   * Handle stop all notes event
   * Requirements: 4.1, 4.6
   */
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
      isKeyHeld: data.isKeyHeld,
      sampleNotes: data.sampleNotes
    });

    console.log('📤 Note broadcast completed using socket.broadcast.emit()');
  }

  /**
   * Handle change instrument through namespace - Requirements: 7.1, 7.2
   */
  handleChangeInstrumentNamespace(socket: Socket, data: ChangeInstrumentData, _namespace: Namespace): void {
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
   * Handle stop all notes through namespace
   * Requirements: 7.1, 7.2
   */
  handleStopAllNotesNamespace(socket: Socket, data: { instrument: string; category: string }, _namespace: Namespace): void {
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