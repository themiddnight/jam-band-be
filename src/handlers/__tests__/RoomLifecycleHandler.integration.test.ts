/**
 * Comprehensive Integration Tests for RoomLifecycleHandler
 * Uses Bun test runner with built-in performance APIs
 * Tests all existing room creation edge cases and verifies identical behavior
 * Requirements: 7.2, 8.1
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { Socket as ClientSocket, io as Client } from 'socket.io-client';
import { RoomLifecycleHandler } from '../../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import { RoomService } from '../../services/RoomService';
import { MetronomeService } from '../../services/MetronomeService';
import { NamespaceManager } from '../../services/NamespaceManager';
import { RoomSessionManager } from '../../services/RoomSessionManager';
import { CreateRoomData, JoinRoomData, User } from '../../types';

// Performance metrics collection using Bun's built-in APIs
interface PerformanceMetrics {
  createRoomTimes: number[];
  joinRoomTimes: number[];
  leaveRoomTimes: number[];
  concurrentOperationTimes: number[];
  memoryUsage: number[];
}

describe('RoomLifecycleHandler - Comprehensive Integration Tests', () => {
  let io: Server;
  let serverSocket: any;
  let clientSocket: ClientSocket;
  let roomLifecycleHandler: RoomLifecycleHandler;
  let roomService: RoomService;
  let namespaceManager: NamespaceManager;
  let roomSessionManager: RoomSessionManager;
  let httpServer: any;
  let port: number;

  // Performance benchmarking using Bun's performance APIs
  let performanceMetrics: PerformanceMetrics;

  beforeAll(() => {
    // Initialize performance metrics collection
    performanceMetrics = {
      createRoomTimes: [],
      joinRoomTimes: [],
      leaveRoomTimes: [],
      concurrentOperationTimes: [],
      memoryUsage: []
    };

    console.log('🚀 Starting RoomLifecycleHandler Integration Tests with Bun');
  });

  beforeEach(async () => {
    // Record initial memory usage using Bun's memory APIs
    const initialMemory = process.memoryUsage();
    performanceMetrics.memoryUsage.push(initialMemory.heapUsed);

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
    // Cleanup connections
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    
    // Close server
    if (io) {
      io.close();
    }
    
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    
    // Force garbage collection if available (Bun specific)
    if (global.gc) {
      global.gc();
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterAll(() => {
    // Log comprehensive performance metrics using Bun's console APIs
    console.log('\n📊 Performance Benchmarks Summary:');
    console.log('=====================================');
    
    if (performanceMetrics.createRoomTimes.length > 0) {
      const avgCreateTime = calculateAverage(performanceMetrics.createRoomTimes);
      const minCreateTime = Math.min(...performanceMetrics.createRoomTimes);
      const maxCreateTime = Math.max(...performanceMetrics.createRoomTimes);
      console.log(`🏠 Room Creation:`);
      console.log(`   Average: ${avgCreateTime.toFixed(2)}ms`);
      console.log(`   Min: ${minCreateTime.toFixed(2)}ms`);
      console.log(`   Max: ${maxCreateTime.toFixed(2)}ms`);
      console.log(`   Operations: ${performanceMetrics.createRoomTimes.length}`);
    }

    if (performanceMetrics.joinRoomTimes.length > 0) {
      const avgJoinTime = calculateAverage(performanceMetrics.joinRoomTimes);
      const minJoinTime = Math.min(...performanceMetrics.joinRoomTimes);
      const maxJoinTime = Math.max(...performanceMetrics.joinRoomTimes);
      console.log(`🚪 Room Joining:`);
      console.log(`   Average: ${avgJoinTime.toFixed(2)}ms`);
      console.log(`   Min: ${minJoinTime.toFixed(2)}ms`);
      console.log(`   Max: ${maxJoinTime.toFixed(2)}ms`);
      console.log(`   Operations: ${performanceMetrics.joinRoomTimes.length}`);
    }

    if (performanceMetrics.leaveRoomTimes.length > 0) {
      const avgLeaveTime = calculateAverage(performanceMetrics.leaveRoomTimes);
      const minLeaveTime = Math.min(...performanceMetrics.leaveRoomTimes);
      const maxLeaveTime = Math.max(...performanceMetrics.leaveRoomTimes);
      console.log(`🚶 Room Leaving:`);
      console.log(`   Average: ${avgLeaveTime.toFixed(2)}ms`);
      console.log(`   Min: ${minLeaveTime.toFixed(2)}ms`);
      console.log(`   Max: ${maxLeaveTime.toFixed(2)}ms`);
      console.log(`   Operations: ${performanceMetrics.leaveRoomTimes.length}`);
    }

    if (performanceMetrics.concurrentOperationTimes.length > 0) {
      const avgConcurrentTime = calculateAverage(performanceMetrics.concurrentOperationTimes);
      console.log(`⚡ Concurrent Operations:`);
      console.log(`   Average: ${avgConcurrentTime.toFixed(2)}ms`);
      console.log(`   Operations: ${performanceMetrics.concurrentOperationTimes.length}`);
    }

    // Memory usage analysis
    if (performanceMetrics.memoryUsage.length > 0) {
      const avgMemory = calculateAverage(performanceMetrics.memoryUsage);
      const maxMemory = Math.max(...performanceMetrics.memoryUsage);
      console.log(`💾 Memory Usage:`);
      console.log(`   Average: ${(avgMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`   Peak: ${(maxMemory / 1024 / 1024).toFixed(2)}MB`);
    }

    console.log('=====================================\n');
  });

  describe('Room Creation - Edge Cases', () => {
    it('should create public room with performance benchmark', async () => {
      // Use Bun's high-resolution timer
      const startTime = Bun.nanoseconds();
      
      const createRoomData: CreateRoomData = {
        name: 'Performance Test Room',
        username: 'TestUser',
        userId: 'user-123',
        roomType: 'perform' as const,
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000; // Convert to milliseconds
      performanceMetrics.createRoomTimes.push(durationMs);

      // Verify room creation
      expect(result).toMatchObject({
        room: expect.objectContaining({
          name: 'Performance Test Room',
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
      expect(rooms[0].name).toBe('Performance Test Room');

      // Performance assertion - should complete within 50ms
      expect(durationMs).toBeLessThan(50);
    });

    it('should create private room with approval namespace', async () => {
      const startTime = Bun.nanoseconds();
      
      const createRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'Owner',
        userId: 'owner-123',
        roomType: 'perform' as const,
        isPrivate: true,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      performanceMetrics.createRoomTimes.push(durationMs);

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

    it('should prevent duplicate room creation from same socket', async () => {
      const createRoomData: CreateRoomData = {
        name: 'First Room',
        username: 'TestUser',
        userId: 'user-123',
        roomType: 'perform' as const,
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
      const secondRoomHandler = () => {
        secondRoomCreated = true;
      };
      clientSocket.on('room_created', secondRoomHandler);

      clientSocket.emit('create_room', secondRoomData);
      
      // Wait to ensure no second room is created
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(secondRoomCreated).toBe(false);
      
      // Verify only one room exists
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].name).toBe('First Room');

      // Cleanup listener
      clientSocket.off('room_created', secondRoomHandler);
    });

    it('should handle room creation with special characters and unicode', async () => {
      const createRoomData: CreateRoomData = {
        name: '🎵 Test Room with émojis & spëcial chars! 音楽',
        username: 'Tëst Üser 👤',
        userId: 'user-unicode-123',
        roomType: 'perform' as const,
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;

      expect(result).toMatchObject({
        room: expect.objectContaining({
          name: '🎵 Test Room with émojis & spëcial chars! 音楽'
        }),
        user: expect.objectContaining({
          username: 'Tëst Üser 👤'
        })
      });
    });

    it('should broadcast room creation to multiple clients', async () => {
      // Create multiple clients to receive broadcast
      const clients: ClientSocket[] = [];
      const broadcastPromises: Promise<any>[] = [];

      for (let i = 0; i < 3; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        broadcastPromises.push(new Promise((resolve) => {
          client.on('room_created_broadcast', resolve);
        }));
      }

      const createRoomData: CreateRoomData = {
        name: 'Broadcast Room',
        username: 'Creator',
        userId: 'creator-123',
        roomType: 'perform' as const,
        isPrivate: false,
        isHidden: false
      };

      clientSocket.emit('create_room', createRoomData);
      const broadcasts = await Promise.all(broadcastPromises);

      // Verify all clients received the broadcast
      broadcasts.forEach(broadcast => {
        expect(broadcast).toMatchObject({
          name: 'Broadcast Room',
          owner: 'creator-123',
          isPrivate: false,
          userCount: 1
        });
      });

      // Cleanup clients
      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });
  });

  describe('Room Joining - Complex Scenarios', () => {
    let roomId: string;

    beforeEach(async () => {
      // Create a room for joining tests
      const createRoomData: CreateRoomData = {
        name: 'Join Test Room',
        username: 'Owner',
        userId: 'owner-123',
        roomType: 'perform' as const,
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

    it('should join room with performance benchmark', async () => {
      const startTime = Bun.nanoseconds();
      
      // Create second client to join room
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Joiner',
        userId: 'joiner-123',
        roomType: 'perform' as const,
        role: 'audience'
      };

      const roomJoinedPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      const result = await roomJoinedPromise;

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      performanceMetrics.joinRoomTimes.push(durationMs);

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

      // Performance assertion - should complete within 25ms
      expect(durationMs).toBeLessThan(25);

      joinerClient.disconnect();
    });

    it('should handle rapid successive joins from same user (page refresh simulation)', async () => {
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'RapidJoiner',
        userId: 'rapid-joiner-123',
        roomType: 'perform' as const,
        role: 'band_member'
      };

      // First join
      const firstJoinPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      await firstJoinPromise;

      // Rapid second join (simulating page refresh)
      const secondJoinPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      await secondJoinPromise;

      // Verify user is not duplicated
      const room = roomService.getRoom(roomId);
      const userCount = Array.from(room!.users.values()).filter(u => u.id === 'rapid-joiner-123').length;
      expect(userCount).toBe(1);

      joinerClient.disconnect();
    });

    it('should handle grace period restoration correctly', async () => {
      // Join room first
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'GraceUser',
        userId: 'grace-123',
        roomType: 'perform' as const,
        role: 'band_member'
      };

      const joinPromise = new Promise((resolve) => {
        joinerClient.on('room_joined', resolve);
      });

      joinerClient.emit('join_room', joinRoomData);
      await joinPromise;

      // Simulate unintentional disconnect
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

    it('should handle private room approval workflow', async () => {
      // Create private room
      const privateRoomData: CreateRoomData = {
        name: 'Private Room',
        username: 'PrivateOwner',
        userId: 'private-owner-123',
        roomType: 'perform' as const,
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
        roomType: 'perform' as const,
        role: 'band_member'
      };

      joinerClient.emit('join_room', joinRoomData);
      const redirect = await redirectPromise;

      expect(redirect).toMatchObject({
        roomId: privateRoomId,
        approvalNamespace: `/approval/${privateRoomId}`
      });

      // Verify user was not added to room directly
      const room = roomService.getRoom(privateRoomId);
      expect(room?.users.has('musician-123')).toBe(false);

      joinerClient.disconnect();
    });

    it('should handle non-existent room gracefully', async () => {
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const errorPromise = new Promise((resolve) => {
        joinerClient.on('error', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId: 'non-existent-room-id',
        username: 'Joiner',
        userId: 'joiner-123',
        roomType: 'perform' as const,
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

  describe('Room Leaving - Ownership Transfer & Cleanup', () => {
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
        roomType: 'perform' as const,
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
        roomType: 'perform' as const,
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

    it('should handle member leaving with performance benchmark', async () => {
      const startTime = Bun.nanoseconds();
      
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

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      performanceMetrics.leaveRoomTimes.push(durationMs);

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

      // Performance assertion - should complete within 25ms
      expect(durationMs).toBeLessThan(25);
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

    it('should handle unintentional disconnect with grace period', async () => {
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
  });

  describe('Performance Benchmarks - Bun Specific', () => {
    it('should handle concurrent room operations efficiently', async () => {
      const concurrentOperations = 20;
      const startTime = Bun.nanoseconds();

      // Create multiple clients
      const clients: ClientSocket[] = [];
      for (let i = 0; i < concurrentOperations; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });
      }

      // Perform concurrent room creations
      const promises: Promise<any>[] = [];
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
            isPrivate: i % 3 === 0, // Mix of private and public rooms
            isHidden: i % 5 === 0   // Some hidden rooms
          };

          client.emit('create_room', createRoomData);
        }
      }

      await Promise.all(promises);

      const endTime = Bun.nanoseconds();
      const totalDurationMs = (endTime - startTime) / 1_000_000;
      performanceMetrics.concurrentOperationTimes.push(totalDurationMs);

      // Performance assertion - should complete within 500ms
      expect(totalDurationMs).toBeLessThan(500);

      // Verify all rooms were created
      const rooms = roomService.getAllRooms();
      expect(rooms).toHaveLength(concurrentOperations + 1); // +1 for the room created in beforeEach

      console.log(`✅ Created ${concurrentOperations} rooms concurrently in ${totalDurationMs.toFixed(2)}ms`);

      // Cleanup
      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });

    it('should maintain performance under high user load', async () => {
      // Create a room first
      const createRoomData: CreateRoomData = {
        name: 'Load Test Room',
        username: 'Owner',
        userId: 'owner-123',
        roomType: 'perform' as const,
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      const roomId = (result as any).room.id;

      // Add many users concurrently
      const userCount = 30;
      const clients: ClientSocket[] = [];
      const startTime = Bun.nanoseconds();

      // Create clients
      for (let i = 0; i < userCount; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });
      }

      // Join room concurrently
      const joinPromises: Promise<any>[] = [];
      for (let i = 0; i < userCount; i++) {
        const client = clients[i];
        if (client) {
          const promise = new Promise((resolve) => {
            client.on('room_joined', resolve);
          });
          joinPromises.push(promise);

          const joinRoomData: JoinRoomData = {
            roomId,
            username: `LoadUser${i}`,
            userId: `load-user-${i}`,
            role: i % 2 === 0 ? 'audience' : 'band_member'
          };

          client.emit('join_room', joinRoomData);
        }
      }

      await Promise.all(joinPromises);

      const endTime = Bun.nanoseconds();
      const totalDurationMs = (endTime - startTime) / 1_000_000;

      // Performance assertion - should handle 30 concurrent joins within 200ms
      expect(totalDurationMs).toBeLessThan(200);

      // Verify all users joined
      const room = roomService.getRoom(roomId);
      expect(room?.users.size).toBe(userCount + 1); // +1 for owner

      console.log(`✅ Added ${userCount} users concurrently in ${totalDurationMs.toFixed(2)}ms`);

      // Cleanup
      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });

    it('should measure memory usage during operations', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform memory-intensive operations
      const operationCount = 50;
      for (let i = 0; i < operationCount; i++) {
        const createRoomData: CreateRoomData = {
          name: `Memory Test Room ${i}`,
          username: `MemUser${i}`,
          userId: `mem-user-${i}`,
          isPrivate: false,
          isHidden: false
        };

        const tempClient = Client(`http://localhost:${port}`);
        await new Promise<void>((resolve) => {
          tempClient.on('connect', resolve);
        });

        const roomCreatedPromise = new Promise((resolve) => {
          tempClient.on('room_created', resolve);
        });

        tempClient.emit('create_room', createRoomData);
        await roomCreatedPromise;

        tempClient.disconnect();
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(`📊 Memory usage increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB for ${operationCount} operations`);

      // Memory should not increase excessively (less than 50MB for 50 operations)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);

      performanceMetrics.memoryUsage.push(finalMemory.heapUsed);
    });
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle malformed data gracefully', async () => {
      const malformedData = {
        name: null,
        username: undefined,
        userId: '',
        roomType: 'perform' as const,
        isPrivate: 'not-a-boolean',
        isHidden: 123
      } as any;

      // Should not crash the handler
      expect(() => {
        clientSocket.emit('create_room', malformedData);
      }).not.toThrow();

      // Wait to ensure no crash
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify no room was created with invalid data
      const rooms = roomService.getAllRooms();
      const invalidRooms = rooms.filter(room => !room.name || room.name === 'null');
      expect(invalidRooms).toHaveLength(0);
    });

    it('should handle extremely long room names and usernames', async () => {
      const longName = 'A'.repeat(1000);
      const longUsername = 'B'.repeat(500);

      const createRoomData: CreateRoomData = {
        name: longName,
        username: longUsername,
        userId: 'long-data-user',
        roomType: 'perform' as const,
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        clientSocket.on('room_created', resolve);
      });

      clientSocket.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;

      // Should handle long data without crashing
      expect(result).toMatchObject({
        room: expect.objectContaining({
          name: longName
        }),
        user: expect.objectContaining({
          username: longUsername
        })
      });
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      const cycles = 10;
      const startTime = Bun.nanoseconds();

      for (let i = 0; i < cycles; i++) {
        const tempClient = Client(`http://localhost:${port}`);
        
        await new Promise<void>((resolve) => {
          tempClient.on('connect', resolve);
        });

        // Immediately disconnect
        tempClient.disconnect();
        
        // Small delay to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const endTime = Bun.nanoseconds();
      const totalDurationMs = (endTime - startTime) / 1_000_000;

      console.log(`✅ Handled ${cycles} connect/disconnect cycles in ${totalDurationMs.toFixed(2)}ms`);

      // Should complete without errors
      expect(totalDurationMs).toBeLessThan(1000); // 1 second for 10 cycles
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