import { EventEmitter } from 'events';
import { Socket } from 'socket.io';

/**
 * Mock Socket implementation for testing
 * Provides a controllable socket interface for testing handlers
 */
export class MockSocket extends EventEmitter {
  public id: string;
  public data: any = {};
  public rooms: Set<string> = new Set();
  public emittedEvents: Array<{ event: string; data: any; timestamp: number }> = [];
  public joinedRooms: string[] = [];
  public leftRooms: string[] = [];

  constructor(id: string = `mock_socket_${Date.now()}`) {
    super();
    this.id = id;
  }

  /**
   * Mock socket.emit - records emitted events for verification
   */
  emit(event: string, ...args: any[]): boolean {
    const data = args.length === 1 ? args[0] : args;
    this.emittedEvents.push({
      event,
      data,
      timestamp: Date.now()
    });
    
    // Also emit the event for listeners
    return super.emit(event, ...args);
  }

  /**
   * Mock socket.join - records room joins
   */
  join(room: string): void {
    this.rooms.add(room);
    this.joinedRooms.push(room);
  }

  /**
   * Mock socket.leave - records room leaves
   */
  leave(room: string): void {
    this.rooms.delete(room);
    this.leftRooms.push(room);
  }

  /**
   * Mock socket.to - returns a mock broadcast operator
   */
  to(room: string): MockBroadcastOperator {
    return new MockBroadcastOperator(room, this);
  }

  /**
   * Get all emitted events of a specific type
   */
  getEmittedEvents(eventType?: string): Array<{ event: string; data: any; timestamp: number }> {
    if (eventType) {
      return this.emittedEvents.filter(e => e.event === eventType);
    }
    return [...this.emittedEvents];
  }

  /**
   * Clear recorded events and actions
   */
  clearHistory(): void {
    this.emittedEvents = [];
    this.joinedRooms = [];
    this.leftRooms = [];
  }

  /**
   * Check if socket is in a specific room
   */
  isInRoom(room: string): boolean {
    return this.rooms.has(room);
  }

  /**
   * Simulate receiving an event from client
   */
  simulateReceive(event: string, data: any): void {
    this.emit(event, data);
  }
}

/**
 * Mock broadcast operator for socket.to() functionality
 */
export class MockBroadcastOperator {
  private room: string;
  private socket: MockSocket;

  constructor(room: string, socket: MockSocket) {
    this.room = room;
    this.socket = socket;
  }

  /**
   * Mock broadcast emit - records as a broadcast event
   */
  emit(event: string, ...args: any[]): boolean {
    const data = args.length === 1 ? args[0] : args;
    this.socket.emittedEvents.push({
      event: `broadcast_${event}`,
      data: { room: this.room, ...data },
      timestamp: Date.now()
    });
    return true;
  }
}

/**
 * Factory for creating mock sockets with common configurations
 */
export class MockSocketFactory {
  private static socketCounter = 0;

  /**
   * Create a basic mock socket
   */
  static createSocket(id?: string): MockSocket {
    const socketId = id || `mock_socket_${++this.socketCounter}`;
    return new MockSocket(socketId);
  }

  /**
   * Create a mock socket with session data
   */
  static createSocketWithSession(roomId: string, userId: string, id?: string): MockSocket {
    const socket = this.createSocket(id);
    socket.data = { roomId, userId };
    return socket;
  }

  /**
   * Create multiple mock sockets for testing multi-user scenarios
   */
  static createMultipleSockets(count: number, roomId?: string): MockSocket[] {
    const sockets: MockSocket[] = [];
    
    for (let i = 0; i < count; i++) {
      const socket = this.createSocket();
      if (roomId) {
        socket.data = { roomId, userId: `user_${i + 1}` };
      }
      sockets.push(socket);
    }
    
    return sockets;
  }
}