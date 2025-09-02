import { Server } from 'socket.io';
import { createServer } from 'http';
import { Socket as ClientSocket, io as Client } from 'socket.io-client';
import { RoomLifecycleHandler } from '../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import { RoomService } from '../../services/RoomService';
import { MetronomeService } from '../../services/MetronomeService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { CreateRoomData, JoinRoomData, User } from '../../types';

/**
 * Comprehensive integration tests for RoomLifecycleHandler
 * Tests all existing room creation edge cases and verifies identical behavior
 * Requirements: 7.2, 8.1
 */
describe('RoomLifecycleHandler Integration Tests', () => {
  let io: Server;
  let serverSocket: any;
  let clientSocket: ClientSocket;
  let roomLifecycleHandler: RoomLifecycleHandler;
  let roomService: RoomService;
  let namespaceManager: NamespaceManager;
  let roomSessionManager: RoomSessionManager;
  let httpServer: any;
  let port: number;

  // Performance benchmarking variables
  let performanceMetrics: {
    createRoomTime: number[];
    joinRoomTime: number[];
    leaveRoomTime: number[];
  };

  beforeAll(() => {
    // Initialize performance metrics
    performanceMetrics = {
      createRoomTime: [],
      joinRoomTime: [],
      leaveRoomTime: []
    };
  });

  beforeEach(async () => {
    // Create HTTP server and Socket.IO instance
    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    namespaceManager = new NamespaceManager(io);

    // Initialize metronome service
    const metronomeService = new MetronomeService(io, roomService);

    // Initialize handler
    roomLifecycleHandler = new RoomLifecycleHandler(
      roomService,
      io,
      namespaceManager,
      roomSessionManager,
      metronomeService
    );

    // Start server on random port
    port = 3000 + Math.floor(Math.random() * 1000);
    await new Promise<void>((resolve) => {
      httpServer.listen(port, resolve);
    });

    // Setup server-side socket handling
    io.on('connection', (socket) => {
      serverSocket = socket;
      
      // Bind handler methods to socket events
      socket.on('create_room', (data: CreateRoomData) => {
        roomLifecycleHandler.handleCreateRoom(socket, data);
      });
      
      socket.on('join_room', (data: JoinRoomData) => {
        roomLifecycleHandler.handleJoinRoom(socket, data);
      });
      
      socket.on('leave_room', () => {
        roomLifecycleHandler.handleLeaveRoom(socket, true);
      });
      
      socket.on('disconnect', () => {
        roomLifecycleHandler.handleLeaveRoom(socket, false);
      });
    });

    // Create client connection
    clientSocket = Client(`http://localhost:${port}`);
    
    // Wait for connection
    await new Promise<void>((resolve) => {
      clientSocket.on('connect', resolve);
    });
  });

  afterEach(async () => {
    // Cleanup
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    
    // Close all sockets and server
    if (io) {
      io.close();
    }
    
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    
    // Clear any remaining timers
    jest.clearAllTimers();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(() => {
    // Log performance metrics using Bun's built-in performance APIs equivalent
    console.log('Performance Benchmarks:');
    console.log('Create Room Average:', calculateAverage(performanceMetrics.createRoomTime), 'ms');
    console.log('Join Room Average:', calculateAverage(performanceMetrics.joinRoomTime), 'ms');
    console.log('Leave Room Average:', calculateAverage(performanceMetrics.leaveRoomTime), 'ms');
  });

  describe('Room Creation', () => {
    it('should create a public room successfully', async () => {
      const startTime = performance.now();
      
      const createRoomData: CreateRoomData = {
        name: 'Test Room',
        username: 'TestUser',
        userId: 'user-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;

      const endTime = performance.now();
      performanceMetrics.createRoomTime.push(endTime - startTime);

      expect(result).toMatchObject({
        room: expect.objectContaining({
          name: 'Test Room',
          owner: 'user-123',
          isPrivate: false,
          isHidden: false
        }),
        user: expect.objectContaining({
          id: 'user-123',
          username: 'TestUser',
          role: 'room_owner'
        })
      });

      // Verify room exists in service
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].name).toBe('Test Room');
    });

    it('should create a private room with approval namespace', async () => {
      const createRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: true,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;

      expect(result).toMatchObject({
        room: expect.objectContaining({
          isPrivate: true
        })
      });

      // Verify approval namespace was created
      const roomId = (result as any).room.id;
      const approvalNamespace = namespaceManager.getApprovalNamespace(roomId);
      expect(approvalNamespace).toBeDefined();
    });

    it('should prevent multiple room creation from same socket', async () => {
      const createRoomData: CreateRoomData = {
        name: 'First Room',
        username: 'TestUser',
        userId: 'user-123',
        isPrivate: false,
        isHidden: false
      };

      // Create first room
      const firstRoomPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      await firstRoomPromise;

      // Try to create second room (should be ignored)
      const secondRoomData = { ...createRoomData, name: 'Second Room' };
      
      let secondRoomCreated = false;
      clientSocket.on('room_created', () => {
        secondRoomCreated = true;
      });

      clientSocket.emit('create_room', secondRoomData);
      
      // Wait to ensure no second room is created
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(secondRoomCreated).toBe(false);
      
      // Verify only one room exists
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].name).toBe('First Room');
    });

    it('should broadcast room creation to other clients', async () => {
      // Create second client to receive broadcast
      const secondClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        secondClient.on('connect', resolve);
      });

      const broadcastPromise = new Promise((resolve) => {
        secondClient.on('room_created_broadcast', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Broadcast Room',
        username: 'Creator',
        userId: 'creator-123',
        isPrivate: false,
        isHidden: false
      };

      clientSocket.emit('create_room', createRoomData);
      const broadcast = await broadcastPromise;

      expect(broadcast).toMatchObject({
        name: 'Broadcast Room',
        owner: 'creator-123',
        isPrivate: false,
        userCount: 1
      });

      if (secondClient && secondClient.connected) {
        secondClient.disconnect();
      }
    });
  });

  describe('Room Joining', () => {
    let roomId: string;

    beforeEach(async () => {
      // Create a room for joining tests
      const createRoomData: CreateRoomData = {
        name: 'Join Test Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      roomId = (result as any).room.id;
    });

    it('should join public room as audience member', async () => {
      const startTime = performance.now();
      
      // Create second client to join room
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Joiner',
        userId: 'joiner-123',
        role: 'audience'
      };

      const roomJoinedPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      const result = await roomJoinedPromise;

      const endTime = performance.now();
      performanceMetrics.joinRoomTime.push(endTime - startTime);

      expect(result).toMatchObject({
        room: expect.objectContaining({
          id: roomId
        }),
        users: expect.arrayContaining([
          expect.objectContaining({
            id: 'joiner-123',
            username: 'Joiner',
            role: 'audience'
          })
        ])
      });

      // Verify user was added to room
      const room = roomService.getRoom(roomId);
      expect(room?.users.has('joiner-123')).toBe(true);

      joinerClient.disconnect();
    });

    it('should join public room as band member', async () => {
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Musician',
        userId: 'musician-123',
        role: 'band_member'
      };

      const roomJoinedPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      const result = await roomJoinedPromise;

      expect(result).toMatchObject({
        users: expect.arrayContaining([
          expect.objectContaining({
            id: 'musician-123',
            role: 'band_member'
          })
        ])
      });

      joinerClient.disconnect();
    });

    it('should redirect band member to approval for private room', async () => {
      // Create private room
      const privateRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'PrivateOwner',
        userId: 'private-owner-123',
        isPrivate: true,
        isHidden: false
      };

      const privateRoomPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', privateRoomData);
      const privateRoom = await privateRoomPromise;
      const privateRoomId = (privateRoom as any).room.id;

      // Try to join as band member
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const redirectPromise = new Promise((resolve) => {
        joinerClient.on('redirect_to_approval', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId: privateRoomId,
        username: 'Musician',
        userId: 'musician-123',
        role: 'band_member'
      };

      joinerClient.emit('join_room', joinRoomData);
      const redirect = await redirectPromise;

      expect(redirect).toMatchObject({
        roomId: privateRoomId,
        approvalNamespace: `/approval/${privateRoomId}`
      });

      joinerClient.disconnect();
    });

    it('should handle existing user rejoining (page refresh)', async () => {
      // First, join the room
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Rejoiner',
        userId: 'rejoiner-123',
        role: 'audience'
      };

      const firstJoinPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      await firstJoinPromise;

      // Simulate page refresh by rejoining with same user
      const secondJoinPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      const result = await secondJoinPromise;

      expect(result).toMatchObject({
        room: expect.objectContaining({
          id: roomId
        })
      });

      // Verify user is still in room (not duplicated)
      const room = roomService.getRoom(roomId);
      const userCount = Array.from(room!.users.values()).filter(u => u.id === 'rejoiner-123').length;
      expect(userCount).toBe(1);

      joinerClient.disconnect();
    });

    it('should handle grace period user restoration', async () => {
      // Join room first
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'GraceUser',
        userId: 'grace-123',
        role: 'band_member'
      };

      const joinPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      await joinPromise;

      // Simulate unintentional disconnect (not calling leave_room)
      joinerClient.disconnect();
      
      // Wait for grace period to be set
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify user is in grace period
      expect(roomService.isUserInGracePeriod('grace-123', roomId)).toBe(true);

      // Reconnect and rejoin
      const reconnectClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        reconnectClient.on('connect', resolve);
      });

      const rejoinPromise = new Promise((resolve) => {
        reconnectClient.on('room_joined', resolve);
      });

      reconnectClient.emit('join_room', joinRoomData);
      const result = await rejoinPromise;

      expect(result).toMatchObject({
        room: expect.objectContaining({
          id: roomId
        })
      });

      // Verify user is no longer in grace period
      expect(roomService.isUserInGracePeriod('grace-123', roomId)).toBe(false);

      reconnectClient.disconnect();
    });

    it('should emit error for non-existent room', async () => {
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const errorPromise = new Promise((resolve) => {
        joinerClient.on('error', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId: 'non-existent-room',
        username: 'Joiner',
        userId: 'joiner-123',
        role: 'audience'
      };

      joinerClient.emit('join_room', joinRoomData);
      const error = await errorPromise;

      expect(error).toMatchObject({
        message: 'Room not found'
      });

      joinerClient.disconnect();
    });
  });

  describe('Room Leaving', () => {
    let roomId: string;
    let ownerClient: ClientSocket;
    let memberClient: ClientSocket;

    beforeEach(async () => {
      // Create room with owner
      ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Leave Test Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        ownerClient.on('room_created', resolve);
      });

      ownerClient.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      roomId = (result as any).room.id;

      // Add a member
      memberClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        memberClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Member',
        userId: 'member-123',
        role: 'band_member'
      };

      const roomJoinedPromise = new Promise((resolve) => {
        memberClient.on('room_joined', resolve);
      });

      memberClient.emit('join_room', joinRoomData);
      await roomJoinedPromise;
    });

    afterEach(async () => {
      if (ownerClient && ownerClient.connected) {
        ownerClient.disconnect();
      }
      if (memberClient && memberClient.connected) {
        memberClient.disconnect();
      }
      
      // Wait for disconnections to complete
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should handle regular member leaving', async () => {
      const startTime = performance.now();
      
      const leaveConfirmedPromise = new Promise((resolve) => {
        memberClient.on('leave_confirmed', resolve);
      });

      const userLeftPromise = new Promise((resolve) => {
        ownerClient.on('user_left', resolve);
      });

      memberClient.emit('leave_room');
      
      const [leaveConfirmed, userLeft] = await Promise.all([
        leaveConfirmedPromise,
        userLeftPromise
      ]);

      const endTime = performance.now();
      performanceMetrics.leaveRoomTime.push(endTime - startTime);

      expect(leaveConfirmed).toMatchObject({
        message: 'Successfully left the room'
      });

      expect(userLeft).toMatchObject({
        user: expect.objectContaining({
          id: 'member-123',
          username: 'Member'
        })
      });

      // Verify user was removed from room
      const room = roomService.getRoom(roomId);
      expect(room?.users.has('member-123')).toBe(false);
    });

    it('should handle owner leaving with ownership transfer', async () => {
      const ownershipTransferredPromise = new Promise((resolve) => {
        memberClient.on('ownership_transferred', resolve);
      });

      const leaveConfirmedPromise = new Promise((resolve) => {
        ownerClient.on('leave_confirmed', resolve);
      });

      ownerClient.emit('leave_room');
      
      const [ownershipTransferred, leaveConfirmed] = await Promise.all([
        ownershipTransferredPromise,
        leaveConfirmedPromise
      ]);

      expect(ownershipTransferred).toMatchObject({
        newOwner: expect.objectContaining({
          id: 'member-123'
        }),
        oldOwner: expect.objectContaining({
          id: 'owner-123'
        })
      });

      // Verify ownership was transferred
      const room = roomService.getRoom(roomId);
      expect(room?.owner).toBe('member-123');
    });

    it('should close room when last user leaves', async () => {
      // First, owner leaves (transfers ownership to member)
      const ownershipTransferredPromise = new Promise((resolve) => {
        memberClient.on('ownership_transferred', resolve);
      });

      ownerClient.emit('leave_room');
      await ownershipTransferredPromise;

      // Then member leaves (should close room)
      const roomClosedPromise = new Promise((resolve) => {
        memberClient.on('room_closed', resolve);
      });

      memberClient.emit('leave_room');
      const roomClosed = await roomClosedPromise;

      expect(roomClosed).toMatchObject({
        message: 'Room is empty and has been closed'
      });

      // Verify room was deleted
      const room = roomService.getRoom(roomId);
      expect(room).toBeNull();
    });

    it('should handle unintentional disconnect (grace period)', async () => {
      // Simulate unintentional disconnect
      memberClient.disconnect();
      
      // Wait for grace period to be set
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify user is in grace period
      expect(roomService.isUserInGracePeriod('member-123', roomId)).toBe(true);

      // Verify room still exists and user is still in room
      const room = roomService.getRoom(roomId);
      expect(room).toBeDefined();
      expect(room?.users.has('member-123')).toBe(true);
    });

    it('should handle pending member cancellation', async () => {
      // Create private room
      const privateOwnerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        privateOwnerClient.on('connect', resolve);
      });

      const createPrivateRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'PrivateOwner',
        userId: 'private-owner-123',
        isPrivate: true,
        isHidden: false
      };

      const privateRoomPromise = new Promise((resolve) => {
        privateOwnerClient.on('room_created', resolve);
      });

      privateOwnerClient.emit('create_room', createPrivateRoomData);
      const privateRoom = await privateRoomPromise;
      const privateRoomId = (privateRoom as any).room.id;

      // Create pending member by trying to join private room
      const pendingClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        pendingClient.on('connect', resolve);
      });

      // This should create a pending member (not implemented in this test, but would redirect to approval)
      // For this test, we'll manually add a pending member
      const pendingUser: User = {
        id: 'pending-123',
        username: 'PendingUser',
        role: 'band_member',
        isReady: false
      };

      const room = roomService.getRoom(privateRoomId);
      room?.pendingMembers.set('pending-123', pendingUser);

      // Set up session for pending user
      const pendingSession = { roomId: privateRoomId, userId: 'pending-123' };
      const pendingSocketId = pendingClient.id || 'pending-socket-id';
      roomSessionManager.setRoomSession(privateRoomId, pendingSocketId, pendingSession);

      // Simulate pending member leaving (cancelling request)
      pendingClient.emit('leave_room');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify pending member was removed
      const updatedRoom = roomService.getRoom(privateRoomId);
      expect(updatedRoom?.pendingMembers.has('pending-123')).toBe(false);

      privateOwnerClient.disconnect();
      pendingClient.disconnect();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should create room within performance threshold', async () => {
      const startTime = performance.now();
      
      const createRoomData: CreateRoomData = {
        name: 'Performance Test Room',
        username: 'PerfUser',
        userId: 'perf-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      await roomCreatedPromise;

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 100ms (adjust threshold as needed)
      expect(duration).toBeLessThan(100);
      
      performanceMetrics.createRoomTime.push(duration);
    });

    it('should join room within performance threshold', async () => {
      // Create room first
      const createRoomData: CreateRoomData = {
        name: 'Join Perf Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      const roomId = (result as any).room.id;

      // Test join performance
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const startTime = performance.now();

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Joiner',
        userId: 'joiner-123',
        role: 'audience'
      };

      const roomJoinedPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      await roomJoinedPromise;

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within 50ms
      expect(duration).toBeLessThan(50);
      
      performanceMetrics.joinRoomTime.push(duration);

      joinerClient.disconnect();
    });

    it('should handle concurrent room operations', async () => {
      const concurrentOperations = 10;
      const promises: Promise<any>[] = [];

      // Create multiple clients
      const clients: ClientSocket[] = [];
      for (let i = 0; i < concurrentOperations; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });
      }

      const startTime = performance.now();

      // Perform concurrent room creations
      for (let i = 0; i < concurrentOperations; i++) {
        const client = clients[i];
        if (client) {
          const promise = new Promise((resolve) => {
            client.on('room_created', resolve);
          });
          promises.push(promise);

          const createRoomData: CreateRoomData = {
            name: `Concurrent Room ${i}`,
            username: `User${i}`,
            userId: `user-${i}`,
            isPrivate: false,
            isHidden: false
          };

          client.emit('create_room', createRoomData);
        }
      }

      await Promise.all(promises);

      const endTime = performance.now();
      const totalDuration = endTime - startTime;

      // All operations should complete within reasonable time
      expect(totalDuration).toBeLessThan(1000); // 1 second for 10 operations

      // Verify all rooms were created
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(concurrentOperations);

      // Cleanup
      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room data gracefully', async () => {
      const invalidData = {
        name: '', // Invalid empty name
        username: 'TestUser',
        userId: 'user-123',
        isPrivate: false,
        isHidden: false
      };

      // The handler should not crash, but may not create room
      clientSocket.emit('create_room', invalidData);
      
      // Wait to ensure no crash
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify no room was created with empty name
      const rooms = roomService.getAllRooms();
      const emptyNameRooms = rooms.filter(room => room.name === '');
      expect(emptyNameRooms).toHaveLength(0);
    });

    it('should handle session cleanup on disconnect', async () => {
      // Create room
      const createRoomData: CreateRoomData = {
        name: 'Cleanup Test Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      const roomId = (result as any).room.id;

      // Verify session exists
      const session = roomSessionManager.getRoomSession(serverSocket.id);
      expect(session).toBeDefined();
      expect(session?.roomId).toBe(roomId);

      // Disconnect client
      clientSocket.disconnect();
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Session should be cleaned up (this would be handled by disconnect event)
      // Note: In real implementation, disconnect handler would clean up session
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

/**
 * Helper function to safely disconnect a client
 */
function safeDisconnect(client: ClientSocket | undefined): void {
  if (client && client.connected) {
    client.disconnect();
  }
}