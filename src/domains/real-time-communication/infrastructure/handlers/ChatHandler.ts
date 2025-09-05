import { Socket, Namespace } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RoomService } from '../../../../services/RoomService';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { ChatMessageData, ChatMessage } from '../../../../types';

/**
 * ChatHandler - Handles chat message functionality
 * Requirements: 4.1, 4.6
 * 
 * Extracted from RoomHandlers.ts to provide focused chat message handling
 * with proper namespace isolation and message validation.
 */
export class ChatHandler {
  constructor(
    private roomService: RoomService,
    private namespaceManager: NamespaceManager,
    private roomSessionManager: RoomSessionManager
  ) {}

  /**
   * Handle chat message - Requirements: 4.1, 4.6
   * Validates user session, creates chat message, and broadcasts to room namespace
   */
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

    // Validate message content
    if (!data.message || typeof data.message !== 'string' || data.message.trim().length === 0) {
      console.log(`Invalid chat message from user ${session.userId}`);
      return;
    }

    // Sanitize message (basic sanitization)
    const sanitizedMessage = data.message.trim().substring(0, 500); // Limit message length

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      message: sanitizedMessage,
      timestamp: Date.now()
    };

    // Get the room namespace for proper isolation
    const roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (roomNamespace) {
      // Broadcast chat message to all users in the room
      roomNamespace.emit('chat_message', chatMessage);
      console.log(`💬 Chat message broadcasted in room ${roomId} by ${user.username}: ${sanitizedMessage}`);
    } else {
      console.warn(`Room namespace not found for room ${roomId}`);
    }
  }

  /**
   * Handle chat message through namespace - Requirements: 4.1, 4.6
   * Namespace-aware version that broadcasts directly through the provided namespace
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

    // Validate message content
    if (!data.message || typeof data.message !== 'string' || data.message.trim().length === 0) {
      console.log(`Invalid chat message from user ${session.userId}`);
      return;
    }

    // Sanitize message (basic sanitization)
    const sanitizedMessage = data.message.trim().substring(0, 500); // Limit message length

    const chatMessage: ChatMessage = {
      id: uuidv4(),
      userId: user.id,
      username: user.username,
      message: sanitizedMessage,
      timestamp: Date.now()
    };

    // Broadcast chat message to all users in namespace
    namespace.emit('chat_message', chatMessage);
    console.log(`💬 Chat message broadcasted via namespace ${namespace.name} by ${user.username}: ${sanitizedMessage}`);
  }
}