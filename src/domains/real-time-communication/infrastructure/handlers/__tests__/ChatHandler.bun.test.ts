import { describe, it, expect, beforeEach, jest, mock } from 'bun:test';
import { Socket, Namespace } from 'socket.io';
import { ChatHandler } from '../ChatHandler';
import { RoomService } from '../../../../../services/RoomService';
import { NamespaceManager } from '../../../../../services/NamespaceManager';
import { RoomSessionManager } from '../../../../../services/RoomSessionManager';
import { ChatMessageData, User, UserSession, ChatMessage } from '../../../../../types';

/**
 * ChatHandler Bun Test Suite
 * Requirements: 7.2, 8.1
 * 
 * Tests chat message broadcasting using Bun test runner
 * Verifies namespace-aware chat works identically
 * Tests message validation and sanitization
 */

// Mock dependencies
const mockRoomService = {
  findUserInRoom: jest.fn()
} as jest.Mocked<Partial<RoomService>>;

const mockNamespaceManager = {
  getRoomNamespace: jest.fn()
} as jest.Mocked<Partial<NamespaceManager>>;

const mockRoomSessionManager = {
  getRoomSession: jest.fn()
} as jest.Mocked<Partial<RoomSessionManager>>;

// Mock socket and namespace
const mockSocket = {
  id: 'socket-test-123',
  emit: jest.fn(),
  broadcast: {
    emit: jest.fn()
  }
} as jest.Mocked<Partial<Socket>>;

const mockNamespace = {
  name: '/room-test-room-123',
  emit: jest.fn(),
  sockets: new Map()
} as jest.Mocked<Partial<Namespace>>;

describe('ChatHandler - Bun Test Suite', () => {
  let chatHandler: ChatHandler;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

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

  describe('Chat Message Broadcasting', () => {
    const validChatData: ChatMessageData = {
      message: 'Hello everyone in the jam session!'
    };

    const mockSession: UserSession = {
      roomId: 'test-room-123',
      userId: 'user-test-456'
    };

    const mockUser: User = {
      id: 'user-test-456',
      username: 'TestMusicianUser',
      role: 'band_member',
      isReady: true
    };

    it('should broadcast chat message successfully with proper message structure', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      // Assert - Verify service calls
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-test-123');
      expect(mockRoomService.findUserInRoom).toHaveBeenCalledWith('test-room-123', 'user-test-456');
      expect(mockNamespaceManager.getRoomNamespace).toHaveBeenCalledWith('test-room-123');
      
      // Assert - Verify message broadcast
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        id: expect.any(String),
        userId: 'user-test-456',
        username: 'TestMusicianUser',
        message: 'Hello everyone in the jam session!',
        timestamp: expect.any(Number)
      }));
      
      // Assert - Verify logging
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('💬 Chat message broadcasted in room test-room-123 by TestMusicianUser: Hello everyone in the jam session!')
      );
    });

    it('should broadcast multiple messages with unique IDs and timestamps', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      const message1: ChatMessageData = { message: 'First message' };
      const message2: ChatMessageData = { message: 'Second message' };

      // Act
      chatHandler.handleChatMessage(mockSocket as Socket, message1);
      chatHandler.handleChatMessage(mockSocket as Socket, message2);

      // Assert
      expect(mockNamespace.emit).toHaveBeenCalledTimes(2);
      
      const calls = mockNamespace.emit.mock.calls;
      const firstMessage = calls[0][1] as ChatMessage;
      const secondMessage = calls[1][1] as ChatMessage;
      
      // Verify unique IDs
      expect(firstMessage.id).not.toBe(secondMessage.id);
      expect(firstMessage.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(secondMessage.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      
      // Verify different timestamps
      expect(secondMessage.timestamp).toBeGreaterThanOrEqual(firstMessage.timestamp);
      
      // Verify message content
      expect(firstMessage.message).toBe('First message');
      expect(secondMessage.message).toBe('Second message');
    });

    it('should handle different user roles correctly', () => {
      // Test with band member
      const bandMemberUser: User = {
        id: 'band-user-123',
        username: 'BandMember',
        role: 'band_member',
        isReady: true
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue({ ...mockSession, userId: 'band-user-123' });
      mockRoomService.findUserInRoom.mockReturnValue(bandMemberUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        userId: 'band-user-123',
        username: 'BandMember'
      }));

      // Reset mocks
      jest.clearAllMocks();

      // Test with audience member
      const audienceUser: User = {
        id: 'audience-user-456',
        username: 'AudienceMember',
        role: 'audience',
        isReady: true
      };

      mockRoomSessionManager.getRoomSession.mockReturnValue({ ...mockSession, userId: 'audience-user-456' });
      mockRoomService.findUserInRoom.mockReturnValue(audienceUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      chatHandler.handleChatMessage(mockSocket as Socket, validChatData);

      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        userId: 'audience-user-456',
        username: 'AudienceMember'
      }));
    });
  });

  describe('Namespace-Aware Chat Functionality', () => {
    const validChatData: ChatMessageData = {
      message: 'Namespace-specific message!'
    };

    const mockSession: UserSession = {
      roomId: 'namespace-room-789',
      userId: 'namespace-user-101'
    };

    const mockUser: User = {
      id: 'namespace-user-101',
      username: 'NamespaceTestUser',
      role: 'room_owner',
      isReady: true
    };

    it('should broadcast through provided namespace identically to regular method', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);

      // Act
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, validChatData, mockNamespace as Namespace);

      // Assert - Verify service calls (same as regular method)
      expect(mockRoomSessionManager.getRoomSession).toHaveBeenCalledWith('socket-test-123');
      expect(mockRoomService.findUserInRoom).toHaveBeenCalledWith('namespace-room-789', 'namespace-user-101');
      
      // Assert - Verify namespace broadcast
      expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
        id: expect.any(String),
        userId: 'namespace-user-101',
        username: 'NamespaceTestUser',
        message: 'Namespace-specific message!',
        timestamp: expect.any(Number)
      }));
      
      // Assert - Verify namespace-specific logging
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('💬 Chat message broadcasted via namespace /room-test-room-123 by NamespaceTestUser: Namespace-specific message!')
      );
    });

    it('should produce identical message structure in both methods', () => {
      // Arrange
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      const testMessage: ChatMessageData = { message: 'Identical test message' };

      // Act - Call both methods
      chatHandler.handleChatMessage(mockSocket as Socket, testMessage);
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, testMessage, mockNamespace as Namespace);

      // Assert - Both calls should emit identical structure
      expect(mockNamespace.emit).toHaveBeenCalledTimes(2);
      
      const calls = mockNamespace.emit.mock.calls;
      const regularMessage = calls[0][1] as ChatMessage;
      const namespaceMessage = calls[1][1] as ChatMessage;
      
      // Verify identical structure (except for ID and timestamp)
      expect(regularMessage.userId).toBe(namespaceMessage.userId);
      expect(regularMessage.username).toBe(namespaceMessage.username);
      expect(regularMessage.message).toBe(namespaceMessage.message);
      expect(regularMessage).toHaveProperty('id');
      expect(regularMessage).toHaveProperty('timestamp');
      expect(namespaceMessage).toHaveProperty('id');
      expect(namespaceMessage).toHaveProperty('timestamp');
    });

    it('should handle namespace method error cases identically', () => {
      // Test no session case
      mockRoomSessionManager.getRoomSession.mockReturnValue(null);
      
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, validChatData, mockNamespace as Namespace);
      
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Socket socket-test-123 not in any room');

      // Reset and test user not found case
      jest.clearAllMocks();
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(null);
      
      chatHandler.handleChatMessageNamespace(mockSocket as Socket, validChatData, mockNamespace as Namespace);
      
      expect(mockNamespace.emit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('User namespace-user-101 not found in room namespace-room-789');
    });
  });

  describe('Message Validation and Sanitization', () => {
    const mockSession: UserSession = {
      roomId: 'validation-room',
      userId: 'validation-user'
    };

    const mockUser: User = {
      id: 'validation-user',
      username: 'ValidationUser',
      role: 'band_member',
      isReady: true
    };

    beforeEach(() => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
    });

    describe('Message Content Validation', () => {
      it('should reject empty string messages', () => {
        const emptyMessageData: ChatMessageData = { message: '' };
        
        chatHandler.handleChatMessage(mockSocket as Socket, emptyMessageData);
        
        expect(mockNamespace.emit).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user validation-user');
      });

      it('should reject whitespace-only messages', () => {
        const whitespaceMessages = [
          { message: '   ' },
          { message: '\t\t' },
          { message: '\n\n' },
          { message: ' \t \n ' }
        ];

        whitespaceMessages.forEach(messageData => {
          chatHandler.handleChatMessage(mockSocket as Socket, messageData);
        });

        expect(mockNamespace.emit).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledTimes(4);
        expect(consoleLogSpy).toHaveBeenCalledWith('Invalid chat message from user validation-user');
      });

      it('should reject null and undefined messages', () => {
        const invalidMessages = [
          { message: null as any },
          { message: undefined as any }
        ];

        invalidMessages.forEach(messageData => {
          chatHandler.handleChatMessage(mockSocket as Socket, messageData);
        });

        expect(mockNamespace.emit).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      });

      it('should reject non-string message types', () => {
        const nonStringMessages = [
          { message: 123 as any },
          { message: true as any },
          { message: {} as any },
          { message: [] as any }
        ];

        nonStringMessages.forEach(messageData => {
          chatHandler.handleChatMessage(mockSocket as Socket, messageData);
        });

        expect(mockNamespace.emit).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledTimes(4);
      });
    });

    describe('Message Sanitization', () => {
      it('should trim leading and trailing whitespace', () => {
        const paddedMessages = [
          { message: '  Hello world!  ', expected: 'Hello world!' },
          { message: '\t\tGreetings!\n\n', expected: 'Greetings!' },
          { message: ' \n Mixed whitespace \t ', expected: 'Mixed whitespace' }
        ];

        paddedMessages.forEach(({ message, expected }) => {
          chatHandler.handleChatMessage(mockSocket as Socket, { message });
          
          expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
            message: expected
          }));
          
          jest.clearAllMocks();
        });
      });

      it('should limit message length to 500 characters', () => {
        const longMessage = 'a'.repeat(600);
        const expectedMessage = 'a'.repeat(500);
        
        chatHandler.handleChatMessage(mockSocket as Socket, { message: longMessage });
        
        expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
          message: expectedMessage
        }));
      });

      it('should handle exactly 500 character messages', () => {
        const exactLengthMessage = 'b'.repeat(500);
        
        chatHandler.handleChatMessage(mockSocket as Socket, { message: exactLengthMessage });
        
        expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
          message: exactLengthMessage
        }));
      });

      it('should preserve internal whitespace and special characters', () => {
        const specialMessages = [
          'Hello\nworld!',
          'Test\tmessage',
          'Special chars: !@#$%^&*()',
          'Unicode: 🎵🎸🥁',
          'Mixed: Hello\tworld!\nHow are you? 🎵'
        ];

        specialMessages.forEach(message => {
          chatHandler.handleChatMessage(mockSocket as Socket, { message });
          
          expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
            message: message
          }));
          
          jest.clearAllMocks();
        });
      });
    });

    describe('Message Sanitization in Namespace Method', () => {
      it('should apply identical sanitization in namespace method', () => {
        const testCases = [
          { input: '  Padded message  ', expected: 'Padded message' },
          { input: 'x'.repeat(600), expected: 'x'.repeat(500) },
          { input: '\t\nSpecial\nchars\t', expected: 'Special\nchars' }
        ];

        testCases.forEach(({ input, expected }) => {
          chatHandler.handleChatMessageNamespace(mockSocket as Socket, { message: input }, mockNamespace as Namespace);
          
          expect(mockNamespace.emit).toHaveBeenCalledWith('chat_message', expect.objectContaining({
            message: expected
          }));
          
          jest.clearAllMocks();
        });
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing user session gracefully', () => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(null);
      
      chatHandler.handleChatMessage(mockSocket as Socket, { message: 'Test message' });
      
      expect(mockRoomService.findUserInRoom).not.toHaveBeenCalled();
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('Socket socket-test-123 not in any room');
    });

    it('should handle user not found in room', () => {
      const mockSession: UserSession = {
        roomId: 'test-room',
        userId: 'missing-user'
      };
      
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(null);
      
      chatHandler.handleChatMessage(mockSocket as Socket, { message: 'Test message' });
      
      expect(mockNamespaceManager.getRoomNamespace).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('User missing-user not found in room test-room');
    });

    it('should handle missing room namespace', () => {
      const mockSession: UserSession = {
        roomId: 'missing-namespace-room',
        userId: 'test-user'
      };
      
      const mockUser: User = {
        id: 'test-user',
        username: 'TestUser',
        role: 'band_member',
        isReady: true
      };
      
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(null);
      
      chatHandler.handleChatMessage(mockSocket as Socket, { message: 'Test message' });
      
      expect(consoleWarnSpy).toHaveBeenCalledWith('Room namespace not found for room missing-namespace-room');
    });

    it('should handle concurrent message processing', () => {
      const mockSession: UserSession = {
        roomId: 'concurrent-room',
        userId: 'concurrent-user'
      };
      
      const mockUser: User = {
        id: 'concurrent-user',
        username: 'ConcurrentUser',
        role: 'band_member',
        isReady: true
      };
      
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);

      // Simulate concurrent messages
      const messages = [
        'Message 1',
        'Message 2',
        'Message 3',
        'Message 4',
        'Message 5'
      ];

      messages.forEach(message => {
        chatHandler.handleChatMessage(mockSocket as Socket, { message });
      });

      expect(mockNamespace.emit).toHaveBeenCalledTimes(5);
      
      // Verify all messages were processed
      const calls = mockNamespace.emit.mock.calls;
      messages.forEach((expectedMessage, index) => {
        expect(calls[index][1]).toMatchObject({
          message: expectedMessage,
          userId: 'concurrent-user',
          username: 'ConcurrentUser'
        });
      });
    });
  });

  describe('Performance and Timing', () => {
    const mockSession: UserSession = {
      roomId: 'perf-room',
      userId: 'perf-user'
    };
    
    const mockUser: User = {
      id: 'perf-user',
      username: 'PerfUser',
      role: 'band_member',
      isReady: true
    };

    beforeEach(() => {
      mockRoomSessionManager.getRoomSession.mockReturnValue(mockSession);
      mockRoomService.findUserInRoom.mockReturnValue(mockUser);
      mockNamespaceManager.getRoomNamespace.mockReturnValue(mockNamespace as Namespace);
    });

    it('should generate accurate timestamps', () => {
      const beforeTime = Date.now();
      
      chatHandler.handleChatMessage(mockSocket as Socket, { message: 'Timestamp test' });
      
      const afterTime = Date.now();
      const emittedMessage = mockNamespace.emit.mock.calls[0][1] as ChatMessage;
      
      expect(emittedMessage.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(emittedMessage.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should handle rapid message succession with unique timestamps', () => {
      const messages = ['Rapid 1', 'Rapid 2', 'Rapid 3'];
      const timestamps: number[] = [];

      messages.forEach(message => {
        chatHandler.handleChatMessage(mockSocket as Socket, { message });
        const emittedMessage = mockNamespace.emit.mock.calls[mockNamespace.emit.mock.calls.length - 1][1] as ChatMessage;
        timestamps.push(emittedMessage.timestamp);
      });

      // Verify timestamps are in ascending order (or at least non-decreasing)
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });

    it('should process messages efficiently under load', () => {
      const messageCount = 100;
      const startTime = Bun.nanoseconds();

      for (let i = 0; i < messageCount; i++) {
        chatHandler.handleChatMessage(mockSocket as Socket, { message: `Load test message ${i}` });
      }

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000; // Convert to milliseconds

      expect(mockNamespace.emit).toHaveBeenCalledTimes(messageCount);
      expect(durationMs).toBeLessThan(100); // Should process 100 messages in under 100ms
    });
  });
});