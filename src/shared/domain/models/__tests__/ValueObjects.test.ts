/**
 * Value Objects Tests
 * 
 * Tests for shared domain value objects to ensure proper validation,
 * equality, and generation functionality.
 */

import { RoomId, UserId, AudioBusId, ConnectionId, SessionId, NamespaceId } from '../ValueObjects';

describe('RoomId', () => {
  it('should create RoomId with valid value', () => {
    const roomId = new RoomId('room_123');
    expect(roomId.toString()).toBe('room_123');
  });

  it('should generate unique RoomId', () => {
    const roomId1 = RoomId.generate();
    const roomId2 = RoomId.generate();
    
    expect(roomId1.toString()).not.toBe(roomId2.toString());
    expect(roomId1.toString()).toMatch(/^room_\d+_[a-z0-9]+$/);
  });

  it('should create RoomId from string', () => {
    const roomId = RoomId.fromString('room_test_123');
    expect(roomId.toString()).toBe('room_test_123');
  });

  it('should throw error for empty value', () => {
    expect(() => new RoomId('')).toThrow('RoomId cannot be empty');
    expect(() => new RoomId('   ')).toThrow('RoomId cannot be empty');
  });

  it('should check equality correctly', () => {
    const roomId1 = new RoomId('room_123');
    const roomId2 = new RoomId('room_123');
    const roomId3 = new RoomId('room_456');

    expect(roomId1.equals(roomId2)).toBe(true);
    expect(roomId1.equals(roomId3)).toBe(false);
  });

  it('should support valueOf for string conversion', () => {
    const roomId = new RoomId('room_123');
    expect(roomId.valueOf()).toBe('room_123');
  });
});

describe('UserId', () => {
  it('should create UserId with valid value', () => {
    const userId = new UserId('user_123');
    expect(userId.toString()).toBe('user_123');
  });

  it('should generate unique UserId', () => {
    const userId1 = UserId.generate();
    const userId2 = UserId.generate();
    
    expect(userId1.toString()).not.toBe(userId2.toString());
    expect(userId1.toString()).toMatch(/^user_\d+_[a-z0-9]+$/);
  });

  it('should create UserId from string', () => {
    const userId = UserId.fromString('user_test_123');
    expect(userId.toString()).toBe('user_test_123');
  });

  it('should throw error for empty value', () => {
    expect(() => new UserId('')).toThrow('UserId cannot be empty');
    expect(() => new UserId('   ')).toThrow('UserId cannot be empty');
  });

  it('should check equality correctly', () => {
    const userId1 = new UserId('user_123');
    const userId2 = new UserId('user_123');
    const userId3 = new UserId('user_456');

    expect(userId1.equals(userId2)).toBe(true);
    expect(userId1.equals(userId3)).toBe(false);
  });
});

describe('AudioBusId', () => {
  it('should create AudioBusId with valid value', () => {
    const audioBusId = new AudioBusId('audiobus_123');
    expect(audioBusId.toString()).toBe('audiobus_123');
  });

  it('should generate unique AudioBusId', () => {
    const audioBusId1 = AudioBusId.generate();
    const audioBusId2 = AudioBusId.generate();
    
    expect(audioBusId1.toString()).not.toBe(audioBusId2.toString());
    expect(audioBusId1.toString()).toMatch(/^audiobus_\d+_[a-z0-9]+$/);
  });

  it('should create AudioBusId from string', () => {
    const audioBusId = AudioBusId.fromString('audiobus_test_123');
    expect(audioBusId.toString()).toBe('audiobus_test_123');
  });

  it('should throw error for empty value', () => {
    expect(() => new AudioBusId('')).toThrow('AudioBusId cannot be empty');
    expect(() => new AudioBusId('   ')).toThrow('AudioBusId cannot be empty');
  });

  it('should check equality correctly', () => {
    const audioBusId1 = new AudioBusId('audiobus_123');
    const audioBusId2 = new AudioBusId('audiobus_123');
    const audioBusId3 = new AudioBusId('audiobus_456');

    expect(audioBusId1.equals(audioBusId2)).toBe(true);
    expect(audioBusId1.equals(audioBusId3)).toBe(false);
  });
});

describe('ConnectionId', () => {
  it('should create ConnectionId with valid value', () => {
    const connectionId = new ConnectionId('conn_123');
    expect(connectionId.toString()).toBe('conn_123');
  });

  it('should generate unique ConnectionId', () => {
    const connectionId1 = ConnectionId.generate();
    const connectionId2 = ConnectionId.generate();
    
    expect(connectionId1.toString()).not.toBe(connectionId2.toString());
    expect(connectionId1.toString()).toMatch(/^conn_\d+_[a-z0-9]+$/);
  });

  it('should create ConnectionId from string', () => {
    const connectionId = ConnectionId.fromString('conn_test_123');
    expect(connectionId.toString()).toBe('conn_test_123');
  });

  it('should throw error for empty value', () => {
    expect(() => new ConnectionId('')).toThrow('ConnectionId cannot be empty');
    expect(() => new ConnectionId('   ')).toThrow('ConnectionId cannot be empty');
  });

  it('should check equality correctly', () => {
    const connectionId1 = new ConnectionId('conn_123');
    const connectionId2 = new ConnectionId('conn_123');
    const connectionId3 = new ConnectionId('conn_456');

    expect(connectionId1.equals(connectionId2)).toBe(true);
    expect(connectionId1.equals(connectionId3)).toBe(false);
  });
});

describe('SessionId', () => {
  it('should create SessionId with valid value', () => {
    const sessionId = new SessionId('session_123');
    expect(sessionId.toString()).toBe('session_123');
  });

  it('should generate unique SessionId', () => {
    const sessionId1 = SessionId.generate();
    const sessionId2 = SessionId.generate();
    
    expect(sessionId1.toString()).not.toBe(sessionId2.toString());
    expect(sessionId1.toString()).toMatch(/^session_\d+_[a-z0-9]+$/);
  });

  it('should create SessionId from string', () => {
    const sessionId = SessionId.fromString('session_test_123');
    expect(sessionId.toString()).toBe('session_test_123');
  });

  it('should throw error for empty value', () => {
    expect(() => new SessionId('')).toThrow('SessionId cannot be empty');
    expect(() => new SessionId('   ')).toThrow('SessionId cannot be empty');
  });

  it('should check equality correctly', () => {
    const sessionId1 = new SessionId('session_123');
    const sessionId2 = new SessionId('session_123');
    const sessionId3 = new SessionId('session_456');

    expect(sessionId1.equals(sessionId2)).toBe(true);
    expect(sessionId1.equals(sessionId3)).toBe(false);
  });
});

describe('NamespaceId', () => {
  it('should create NamespaceId with valid value', () => {
    const namespaceId = new NamespaceId('ns_123');
    expect(namespaceId.toString()).toBe('ns_123');
  });

  it('should generate unique NamespaceId', () => {
    const namespaceId1 = NamespaceId.generate();
    const namespaceId2 = NamespaceId.generate();
    
    expect(namespaceId1.toString()).not.toBe(namespaceId2.toString());
    expect(namespaceId1.toString()).toMatch(/^ns_\d+_[a-z0-9]+$/);
  });

  it('should create NamespaceId from string', () => {
    const namespaceId = NamespaceId.fromString('ns_test_123');
    expect(namespaceId.toString()).toBe('ns_test_123');
  });

  it('should create NamespaceId from RoomId', () => {
    const roomId = new RoomId('room_123');
    const namespaceId = NamespaceId.fromRoomId(roomId);
    expect(namespaceId.toString()).toBe('ns_room_123');
  });

  it('should throw error for empty value', () => {
    expect(() => new NamespaceId('')).toThrow('NamespaceId cannot be empty');
    expect(() => new NamespaceId('   ')).toThrow('NamespaceId cannot be empty');
  });

  it('should check equality correctly', () => {
    const namespaceId1 = new NamespaceId('ns_123');
    const namespaceId2 = new NamespaceId('ns_123');
    const namespaceId3 = new NamespaceId('ns_456');

    expect(namespaceId1.equals(namespaceId2)).toBe(true);
    expect(namespaceId1.equals(namespaceId3)).toBe(false);
  });
});

describe('Cross-type equality', () => {
  it('should not consider different ID types as equal', () => {
    const roomId = new RoomId('test_123');
    const userId = new UserId('test_123');
    
    // TypeScript should prevent this, but testing runtime behavior
    expect(roomId.equals(userId as any)).toBe(false);
  });
});