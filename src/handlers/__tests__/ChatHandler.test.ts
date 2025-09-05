import { describe, it, expect, beforeEach, jest, mock } from 'bun:test';
import { Socket, Namespace } from 'socket.io';
import { ChatHandler } from '../../domains/real-time-communication/infrastructure/handlers/ChatHandler';
import { RoomService } from '../../services/RoomService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { ChatMessageData, User, UserSession } from '../../types';

// Mock dependencies
const mockRoomService = {
  findUserInRoom: jest.fn()
} as Partial<RoomService>;

const mockNamespaceManager = {
  getRoomNamespace: jest.fn()
} as Partial<NamespaceManager>;

const mockRoomSessionManager = {
  getRoomSession: jest.fn()
} as Partial<RoomSessionManager>;

// Mock socket and namespace
const mockSocket = {
  id: 'socket-123',
  emit: jest.fn(),
  broadcast: {
    emit: jest.fn()
  }
} as Partial<Socket>;

const mockNamespace = {
  name: '/room-test-room',
  emit: jest.fn(),
  sockets: new Map()
} as Partial<Namespace>;

describe('ChatHandler', () => {
  let chatHandler: ChatHandler;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create handler instance
    chatHandler = new ChatHandler(
      mockRoomService as RoomService,
      mockNamespaceManager as NamespaceManager,
      mockRoomSessionManager as RoomSessionManager
    );

    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('handleChatMessage', () => {
    const validChatData: ChatMessageData = {
      message: 'Hello everyone!'
    };

    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-123'
    };

    const mockUser: User = {
      id: 'user-123',
      username: 'TestUser',
      role: 'band_member',
      isReady: true
    };

    it('should broadcast chat message when user session and room are valid', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      // Assert
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-123');
      expect(mockRoomService.findUserInRoom).toHaveBeenCalledWith('test-room', 'user-123');
      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room');
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        id: expect.any(String),
        userId: 'user-123',
        username: 'TestUser',
        message: 'Hello everyone!',
        timestamp: expect.any(Number)
      }));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('💬 Chat message broadcasted in room test-room by TestUser: Hello everyone!')
      );
    });

    it('should return early when socket has no session', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(null);

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      // Assert
      expect(mockRoomService.findUserInRoom).not.toHaveBeenCalled();
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Socket socket-123 not in any room');
    });

    it('should return early when user not found in room', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(null);

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      // Assert
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('User user-123 not found in room test-room');
    });

    it('should validate and reject empty messages', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      const emptyMessageData: ChatMessageData = { message: '' };

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, emptyMessageData);

      // Assert
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user user-123');
    });

    it('should validate and reject whitespace-only messages', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      const whitespaceMessageData: ChatMessageData = { message: '   ' };

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, whitespaceMessageData);

      // Assert
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user user-123');
    });

    it('should sanitize message by trimming whitespace', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
      const paddedMessageData: ChatMessageData = { message: '  Hello world!  ' };

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, paddedMessageData);

      // Assert
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        message: 'Hello world!'
      }));
    });

    it('should limit message length to 500 characters', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
      const longMessage = 'a'.repeat(600);
      const longMessageData: ChatMessageData = { message: longMessage };

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, longMessageData);

      // Assert
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        message: 'a'.repeat(500)
      }));
    });

    it('should warn when room namespace not found', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(null);

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith('Room namespace not found for room test-room');
    });

    it('should generate unique message IDs', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      // Assert
      const calls = mockNamespace.emit.mock.calls;
      expect(calls).toHaveLength(2);
      const firstMessageId = calls[0][1].id;
      const secondMessageId = calls[1][1].id;
      expect(firstMessageId).not.toBe(secondMessageId);
    });
  });

  describe('handleChatMessageNamespace', () => {
    const validChatData: ChatMessageData = {
      message: 'Hello namespace!'
    };

    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-456'
    };

    const mockUser: User = {
      id: 'user-456',
      username: 'NamespaceUser',
      role: 'audience',
      isReady: true
    };

    it('should broadcast chat message directly through provided namespace', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);

      // Act
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, validChatData, mockNamespace as Namespace);

      // Assert
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-123');
      expect(mockRoomService.findUserInRoom).toHaveBeenCalledWith('test-room', 'user-456');
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        id: expect.any(String),
        userId: 'user-456',
        username: 'NamespaceUser',
        message: 'Hello namespace!',
        timestamp: expect.any(Number)
      }));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('💬 Chat message broadcasted via namespace /room-test-room by NamespaceUser: Hello namespace!')
      );
    });

    it('should return early when socket has no session in namespace method', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(null);

      // Act
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, validChatData, mockNamespace as Namespace);

      // Assert
      expect(mockRoomService.findUserInRoom).not.toHaveBeenCalled();
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Socket socket-123 not in any room');
    });

    it('should return early when user not found in room in namespace method', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(null);

      // Act
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, validChatData, mockNamespace as Namespace);

      // Assert
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('User user-456 not found in room test-room');
    });

    it('should validate and sanitize messages in namespace method', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      const paddedMessageData: ChatMessageData = { message: '  Namespace message!  ' };

      // Act
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, paddedMessageData, mockNamespace as Namespace);

      // Assert
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        message: 'Namespace message!'
      }));
    });

    it('should reject invalid messages in namespace method', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      const invalidMessageData: ChatMessageData = { message: '' };

      // Act
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, invalidMessageData, mockNamespace as Namespace);

      // Assert
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user user-456');
    });
  });

  describe('Message validation and sanitization', () => {
    const mockSession: UserSession = {
      roomId: 'test-room',
      userId: 'user-123'
    };

    const mockUser: User = {
      id: 'user-123',
      username: 'TestUser',
      role: 'band_member',
      isReady: true
    };

    beforeEach(() => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
    });

    it('should handle null message', () => {
      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, { message: null as any });

      // Assert
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user user-123');
    });

    it('should handle undefined message', () => {
      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, { message: undefined as any });

      // Assert
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user user-123');
    });

    it('should handle non-string message', () => {
      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, { message: 123 as any });

      // Assert
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user user-123');
    });

    it('should preserve message timestamp accuracy', () => {
      // Arrange
      const beforeTime = Date.now();

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, { message: 'Test message' });

      // Assert
      const afterTime = Date.now();
      const emittedMessage = mockNamespace.emit.mock.calls[0][1];
      expect(emittedMessage.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(emittedMessage.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });
});