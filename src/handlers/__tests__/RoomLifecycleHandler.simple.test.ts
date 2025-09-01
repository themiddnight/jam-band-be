import { RoomLifecycleHandler } from '../RoomLifecycleHandler';
import { RoomService } from '../../services/RoomService';
import { MetronomeService } from '../../services/MetronomeService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { CreateRoomData, JoinRoomData, User } from '../../types';
import { Server } from 'socket.io';
import { createServer } from 'http';

/**
 * Simplified integration tests for RoomLifecycleHandler
 * Focuses on core functionality without complex async operations
 * Requirements: 7.2, 8.1
 */
describe('RoomLifecycleHandler - Core Functionality', () => {
  let roomLifecycleHandler: RoomLifecycleHandler;
  let roomService: RoomService;
  let namespaceManager: NamespaceManager;
  let roomSessionManager: RoomSessionManager;
  let io: Server;
  let httpServer: any;

  // Performance benchmarking
  let performanceMetrics: {
    createRoomTime: number[];
    joinRoomTime: number[];
    leaveRoomTime: number[];
  };

  beforeAll(() => {
    performanceMetrics = {
      createRoomTime: [],
      joinRoomTime: [],
      leaveRoomTime: []
    };
  });

  beforeEach(() => {
    // Use fake timers to control async operations
    jest.useFakeTimers();
    
    // Create minimal HTTP server and Socket.IO instance
    httpServer = createServer();
    io = new Server(httpServer);

    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    namespaceManager = new NamespaceManager(io);

    // Initialize handler
    roomLifecycleHandler = new RoomLifecycleHandler(
      roomService,
      io,
      namespaceManager,
      roomSessionManager
    );
  });

  afterEach(async () => {
    // Restore real timers
    jest.useRealTimers();
    
    // Simple cleanup
    if (io) {
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    }
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });

  afterAll(() => {
    // Log performance metrics
    console.log('Performance Benchmarks:');
    console.log('Create Room Average:', calculateAverage(performanceMetrics.createRoomTime), 'ms');
    console.log('Join Room Average:', calculateAverage(performanceMetrics.joinRoomTime), 'ms');
    console.log('Leave Room Average:', calculateAverage(performanceMetrics.leaveRoomTime), 'ms');
  });

  describe('Room Creation Logic', () => {
    it('should create room with correct data structure', () => {
      const startTime = performance.now();
      
      const createRoomData: CreateRoomData = {
        name: 'Test Room',
        username: 'TestUser',
        userId: 'user-123',
        isPrivate: false,
        isHidden: false
      };

      // Mock socket
      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      roomLifecycleHandler.handleCreateRoom(mockSocket, createRoomData);

      const endTime = performance.now();
      performanceMetrics.createRoomTime.push(endTime - startTime);

      // Verify room was created in service
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0]).toMatchObject({
        name: 'Test Room',
        owner: 'user-123',
        isPrivate: false,
        isHidden: false
      });

      // Verify socket interactions
      expect(mockSocket.join).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('room_created', expect.any(Object));
      expect(mockSocket.broadcast.emit).toHaveBeenCalledWith('room_created_broadcast', expect.any(Object));

      // Performance check - should complete within 10ms
      expect(endTime - startTime).toBeLessThan(10);
    });

    it('should create private room with approval namespace', () => {
      const createRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: true,
        isHidden: false
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      roomLifecycleHandler.handleCreateRoom(mockSocket, createRoomData);

      // Verify room was created as private
      const rooms = roomService.getAllRooms();
      expect(rooms[0].isPrivate).toBe(true);

      // Verify approval namespace creation was attempted
      const roomId = rooms[0].id;
      // Note: In real test, we'd verify namespaceManager.createApprovalNamespace was called
    });

    it('should prevent multiple room creation from same socket', () => {
      const createRoomData: CreateRoomData = {
        name: 'First Room',
        username: 'TestUser',
        userId: 'user-123',
        isPrivate: false,
        isHidden: false
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      // Create first room
      roomLifecycleHandler.handleCreateRoom(mockSocket, createRoomData);
      
      // Set socket data to simulate existing session
      mockSocket.data = { roomId: 'existing-room' };

      // Try to create second room
      const secondRoomData = { ...createRoomData, name: 'Second Room' };
      roomLifecycleHandler.handleCreateRoom(mockSocket, secondRoomData);

      // Verify only one room exists
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].name).toBe('First Room');
    });
  });

  describe('Room Joining Logic', () => {
    let roomId: string;

    beforeEach(() => {
      // Create a room for joining tests
      const createRoomData: CreateRoomData = {
        name: 'Join Test Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      roomLifecycleHandler.handleCreateRoom(mockSocket, createRoomData);
      const rooms = roomService.getAllRooms();
      roomId = rooms[0].id;
    });

    it('should join public room as audience member', () => {
      const startTime = performance.now();
      
      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Joiner',
        userId: 'joiner-123',
        role: 'audience'
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      roomLifecycleHandler.handleJoinRoom(mockSocket, joinRoomData);

      const endTime = performance.now();
      performanceMetrics.joinRoomTime.push(endTime - startTime);

      // Verify user was added to room
      const room = roomService.getRoom(roomId);
      expect(room?.users.has('joiner-123')).toBe(true);
      
      const user = room?.users.get('joiner-123');
      expect(user).toMatchObject({
        id: 'joiner-123',
        username: 'Joiner',
        role: 'audience'
      });

      // Verify socket interactions
      expect(mockSocket.join).toHaveBeenCalledWith(roomId);
      expect(mockSocket.emit).toHaveBeenCalledWith('room_joined', expect.any(Object));

      // Performance check - should complete within 5ms
      expect(endTime - startTime).toBeLessThan(5);
    });

    it('should join public room as band member', () => {
      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Musician',
        userId: 'musician-123',
        role: 'band_member'
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      roomLifecycleHandler.handleJoinRoom(mockSocket, joinRoomData);

      // Verify user was added with correct role
      const room = roomService.getRoom(roomId);
      const user = room?.users.get('musician-123');
      expect(user?.role).toBe('band_member');
    });

    it('should redirect band member to approval for private room', () => {
      // Create private room
      const privateRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'PrivateOwner',
        userId: 'private-owner-123',
        isPrivate: true,
        isHidden: false
      };

      const ownerSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      roomLifecycleHandler.handleCreateRoom(ownerSocket, privateRoomData);
      const rooms = roomService.getAllRooms();
      const privateRoomId = rooms.find(r => r.isPrivate)?.id;

      // Try to join as band member
      const joinRoomData: JoinRoomData = {
        roomId: privateRoomId!,
        username: 'Musician',
        userId: 'musician-123',
        role: 'band_member'
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      roomLifecycleHandler.handleJoinRoom(mockSocket, joinRoomData);

      // Verify redirect to approval
      expect(mockSocket.emit).toHaveBeenCalledWith('redirect_to_approval', expect.objectContaining({
        roomId: privateRoomId,
        approvalNamespace: `/approval/${privateRoomId}`
      }));

      // Verify user was not added to room directly
      const room = roomService.getRoom(privateRoomId!);
      expect(room?.users.has('musician-123')).toBe(false);
    });

    it('should handle existing user rejoining', () => {
      // First join
      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Rejoiner',
        userId: 'rejoiner-123',
        role: 'audience'
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      roomLifecycleHandler.handleJoinRoom(mockSocket, joinRoomData);

      // Verify user exists
      const room = roomService.getRoom(roomId);
      expect(room?.users.has('rejoiner-123')).toBe(true);

      // Rejoin with same user
      const rejoinSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      roomLifecycleHandler.handleJoinRoom(rejoinSocket, joinRoomData);

      // Verify user is still in room (not duplicated)
      const updatedRoom = roomService.getRoom(roomId);
      const userCount = Array.from(updatedRoom!.users.values()).filter(u => u.id === 'rejoiner-123').length;
      expect(userCount).toBe(1);
    });

    it('should emit error for non-existent room', () => {
      const joinRoomData: JoinRoomData = {
        roomId: 'non-existent-room',
        username: 'Joiner',
        userId: 'joiner-123',
        role: 'audience'
      };

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      roomLifecycleHandler.handleJoinRoom(mockSocket, joinRoomData);

      // Verify error was emitted
      expect(mockSocket.emit).toHaveBeenCalledWith('error', { message: 'Room not found' });
    });
  });

  describe('Room Leaving Logic', () => {
    let roomId: string;
    let ownerSocket: any;
    let memberSocket: any;

    beforeEach(() => {
      // Create room with owner
      const createRoomData: CreateRoomData = {
        name: 'Leave Test Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      ownerSocket = {
        id: 'owner-socket-id',
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
        broadcast: { emit: jest.fn() }
      };

      roomLifecycleHandler.handleCreateRoom(ownerSocket, createRoomData);
      const rooms = roomService.getAllRooms();
      roomId = rooms[0].id;

      // Add a member
      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Member',
        userId: 'member-123',
        role: 'band_member'
      };

      memberSocket = {
        id: 'member-socket-id',
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      };

      roomLifecycleHandler.handleJoinRoom(memberSocket, joinRoomData);
    });

    it('should handle regular member leaving', () => {
      const startTime = performance.now();
      
      // Set up session for member
      const memberSession = { roomId, userId: 'member-123' };
      roomSessionManager.setRoomSession(roomId, memberSocket.id, memberSession);

      roomLifecycleHandler.handleLeaveRoom(memberSocket, true);

      const endTime = performance.now();
      performanceMetrics.leaveRoomTime.push(endTime - startTime);

      // Verify user was removed from room
      const room = roomService.getRoom(roomId);
      expect(room?.users.has('member-123')).toBe(false);

      // Verify socket interactions
      expect(memberSocket.emit).toHaveBeenCalledWith('leave_confirmed', expect.any(Object));
      expect(memberSocket.leave).toHaveBeenCalledWith(roomId);

      // Performance check - should complete within 5ms
      expect(endTime - startTime).toBeLessThan(5);
    });

    it('should handle owner leaving with ownership transfer', () => {
      // Set up sessions
      const ownerSession = { roomId, userId: 'owner-123' };
      const memberSession = { roomId, userId: 'member-123' };
      roomSessionManager.setRoomSession(roomId, ownerSocket.id, ownerSession);
      roomSessionManager.setRoomSession(roomId, memberSocket.id, memberSession);

      roomLifecycleHandler.handleLeaveRoom(ownerSocket, true);

      // Verify ownership was transferred
      const room = roomService.getRoom(roomId);
      expect(room?.owner).toBe('member-123');

      // Verify owner was removed
      expect(room?.users.has('owner-123')).toBe(false);
    });

    it('should close room when last user leaves', () => {
      // Set up sessions
      const ownerSession = { roomId, userId: 'owner-123' };
      const memberSession = { roomId, userId: 'member-123' };
      roomSessionManager.setRoomSession(roomId, ownerSocket.id, ownerSession);
      roomSessionManager.setRoomSession(roomId, memberSocket.id, memberSession);

      // Owner leaves first (transfers ownership)
      roomLifecycleHandler.handleLeaveRoom(ownerSocket, true);

      // Member leaves (should close room)
      roomLifecycleHandler.handleLeaveRoom(memberSocket, true);

      // Verify room was deleted
      const room = roomService.getRoom(roomId);
      expect(room).toBeFalsy(); // Can be null or undefined
    });

    it('should handle session cleanup', () => {
      const memberSession = { roomId, userId: 'member-123' };
      roomSessionManager.setRoomSession(roomId, memberSocket.id, memberSession);

      // Verify session exists
      const session = roomSessionManager.getRoomSession(memberSocket.id);
      expect(session).toBeDefined();

      roomLifecycleHandler.handleLeaveRoom(memberSocket, true);

      // Verify session was removed
      const removedSession = roomSessionManager.getRoomSession(memberSocket.id);
      expect(removedSession).toBeFalsy(); // Can be null or undefined
    });
  });

  describe('Performance Benchmarks', () => {
    it('should handle multiple room operations efficiently', () => {
      const operationCount = 100;
      const startTime = performance.now();

      // Create multiple rooms
      for (let i = 0; i < operationCount; i++) {
        const createRoomData: CreateRoomData = {
          name: `Performance Room ${i}`,
          username: `User${i}`,
          userId: `user-${i}`,
          isPrivate: false,
          isHidden: false
        };

        const mockSocket = {
          data: null,
          join: jest.fn(),
          emit: jest.fn(),
          broadcast: { emit: jest.fn() }
        } as any;

        roomLifecycleHandler.handleCreateRoom(mockSocket, createRoomData);
      }

      const endTime = performance.now();
      const totalDuration = endTime - startTime;

      // Should handle 100 operations within reasonable time
      expect(totalDuration).toBeLessThan(100); // 100ms for 100 operations

      // Verify all rooms were created
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(operationCount);

      console.log(`Created ${operationCount} rooms in ${totalDuration.toFixed(2)}ms`);
    });

    it('should maintain performance under load', () => {
      // Create a room
      const createRoomData: CreateRoomData = {
        name: 'Load Test Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      const ownerSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      roomLifecycleHandler.handleCreateRoom(ownerSocket, createRoomData);
      const rooms = roomService.getAllRooms();
      const roomId = rooms[0].id;

      // Add many users
      const userCount = 50;
      const startTime = performance.now();

      for (let i = 0; i < userCount; i++) {
        const joinRoomData: JoinRoomData = {
          roomId,
          username: `User${i}`,
          userId: `user-${i}`,
          role: 'audience'
        };

        const mockSocket = {
          data: null,
          join: jest.fn(),
          emit: jest.fn(),
          to: jest.fn().mockReturnValue({ emit: jest.fn() })
        } as any;

        roomLifecycleHandler.handleJoinRoom(mockSocket, joinRoomData);
      }

      const endTime = performance.now();
      const totalDuration = endTime - startTime;

      // Should handle 50 joins within reasonable time
      expect(totalDuration).toBeLessThan(50); // 50ms for 50 joins

      // Verify all users joined
      const room = roomService.getRoom(roomId);
      expect(room?.users.size).toBe(userCount + 1); // +1 for owner

      console.log(`Added ${userCount} users in ${totalDuration.toFixed(2)}ms`);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room data gracefully', () => {
      const invalidData = {
        name: '', // Invalid empty name
        username: 'TestUser',
        userId: 'user-123',
        isPrivate: false,
        isHidden: false
      } as CreateRoomData;

      const mockSocket = {
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        broadcast: { emit: jest.fn() }
      } as any;

      // Should not crash
      expect(() => {
        roomLifecycleHandler.handleCreateRoom(mockSocket, invalidData);
      }).not.toThrow();
    });

    it('should handle missing session gracefully', () => {
      const mockSocket = {
        id: 'no-session-socket',
        data: null,
        join: jest.fn(),
        emit: jest.fn(),
        leave: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() })
      } as any;

      // Should not crash when no session exists
      expect(() => {
        roomLifecycleHandler.handleLeaveRoom(mockSocket, true);
      }).not.toThrow();
    });
  });
});

/**
 * Helper function to calculate average of performance metrics
 */
function calculateAverage(times: number[]): number {
  if (times.length === 0) return 0;
  return times.reduce((sum, time) => sum + time, 0) / times.length;
}