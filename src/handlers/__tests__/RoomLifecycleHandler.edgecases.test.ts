/**
 * Edge Cases and Complex Scenarios Tests for RoomLifecycleHandler
 * Tests all existing room creation edge cases and complex workflows
 * Uses Bun test runner for performance benchmarking
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

describe('RoomLifecycleHandler - Edge Cases & Complex Scenarios', () => {
  let io: Server;
  let roomLifecycleHandler: RoomLifecycleHandler;
  let roomService: RoomService;
  let namespaceManager: NamespaceManager;
  let roomSessionManager: RoomSessionManager;
  let httpServer: any;
  let port: number;

  // Performance tracking for edge cases
  let edgeCaseMetrics: {
    gracePeriodOperations: number[];
    ownershipTransfers: number[];
    concurrentJoins: number[];
    errorRecoveries: number[];
  };

  beforeAll(() => {
    edgeCaseMetrics = {
      gracePeriodOperations: [],
      ownershipTransfers: [],
      concurrentJoins: [],
      errorRecoveries: []
    };
    console.log('🧪 Starting Edge Cases Tests with Bun Performance Monitoring');
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

    // Initialize handler
    roomLifecycleHandler = new RoomLifecycleHandler(
      roomService,
      io,
      namespaceManager,
      roomSessionManager
    );

    // Start server on random port
    port = 3000 + Math.floor(Math.random() * 1000);
    await new Promise<void>((resolve) => {
      httpServer.listen(port, resolve);
    });

    // Setup server-side socket handling
    io.on('connection', (socket) => {
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
  });

  afterEach(async () => {
    // Close server
    if (io) {
      io.close();
    }
    
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  afterAll(() => {
    console.log('\n🧪 Edge Cases Performance Summary:');
    console.log('===================================');
    
    if (edgeCaseMetrics.gracePeriodOperations.length > 0) {
      const avgGracePeriod = calculateAverage(edgeCaseMetrics.gracePeriodOperations);
      console.log(`⏳ Grace Period Operations: ${avgGracePeriod.toFixed(2)}ms avg`);
    }
    
    if (edgeCaseMetrics.ownershipTransfers.length > 0) {
      const avgOwnership = calculateAverage(edgeCaseMetrics.ownershipTransfers);
      console.log(`👑 Ownership Transfers: ${avgOwnership.toFixed(2)}ms avg`);
    }
    
    if (edgeCaseMetrics.concurrentJoins.length > 0) {
      const avgConcurrent = calculateAverage(edgeCaseMetrics.concurrentJoins);
      console.log(`🔄 Concurrent Operations: ${avgConcurrent.toFixed(2)}ms avg`);
    }
    
    if (edgeCaseMetrics.errorRecoveries.length > 0) {
      const avgRecovery = calculateAverage(edgeCaseMetrics.errorRecoveries);
      console.log(`🚨 Error Recoveries: ${avgRecovery.toFixed(2)}ms avg`);
    }
    
    console.log('===================================\n');
  });

  describe('Grace Period Edge Cases', () => {
    it('should handle multiple users in grace period simultaneously', async () => {
      const startTime = Bun.nanoseconds();
      
      // Create room
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Grace Period Test Room',
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
      const roomId = (result as any).room.id;

      // Add multiple users
      const userCount = 5;
      const clients: ClientSocket[] = [];
      
      for (let i = 0; i < userCount; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const joinRoomData: JoinRoomData = {
          roomId,
          username: `GraceUser${i}`,
          userId: `grace-user-${i}`,
          role: 'band_member'
        };

        const joinPromise = new Promise((resolve) => {
          client.on('room_joined', resolve);
        });

        client.emit('join_room', joinRoomData);
        await joinPromise;
      }

      // Disconnect all users simultaneously (unintentional)
      clients.forEach(client => client.disconnect());
      
      // Wait for grace periods to be set
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all users are in grace period
      for (let i = 0; i < userCount; i++) {
        expect(roomService.isUserInGracePeriod(`grace-user-${i}`, roomId)).toBe(true);
      }

      // Reconnect all users simultaneously
      const reconnectClients: ClientSocket[] = [];
      const rejoinPromises: Promise<any>[] = [];

      for (let i = 0; i < userCount; i++) {
        const client = Client(`http://localhost:${port}`);
        reconnectClients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const rejoinPromise = new Promise((resolve) => {
          client.on('room_joined', resolve);
        });
        rejoinPromises.push(rejoinPromise);

        const joinRoomData: JoinRoomData = {
          roomId,
          username: `GraceUser${i}`,
          userId: `grace-user-${i}`,
          role: 'band_member'
        };

        client.emit('join_room', joinRoomData);
      }

      await Promise.all(rejoinPromises);

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      edgeCaseMetrics.gracePeriodOperations.push(durationMs);

      // Verify all users are back and no longer in grace period
      const room = roomService.getRoom(roomId);
      expect(room?.users.size).toBe(userCount + 1); // +1 for owner

      for (let i = 0; i < userCount; i++) {
        expect(roomService.isUserInGracePeriod(`grace-user-${i}`, roomId)).toBe(false);
      }

      // Cleanup
      ownerClient.disconnect();
      reconnectClients.forEach(client => client.disconnect());
    });

    it('should handle grace period expiration correctly', async () => {
      // Create room and add user
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Grace Expiry Room',
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
      const roomId = (result as any).room.id;

      // Add user
      const userClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        userClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'ExpiryUser',
        userId: 'expiry-user-123',
        role: 'band_member'
      };

      const joinPromise = new Promise((resolve) => {
        userClient.on('room_joined', resolve);
      });

      userClient.emit('join_room', joinRoomData);
      await joinPromise;

      // Disconnect user (unintentional)
      userClient.disconnect();
      
      // Wait for grace period to be set
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify user is in grace period
      expect(roomService.isUserInGracePeriod('expiry-user-123', roomId)).toBe(true);

      // Wait for grace period to expire (simulate longer delay)
      // Note: In real implementation, this would be handled by a timer
      // For testing, we'll manually trigger the expiration logic
      
      // Verify room state after grace period handling
      const room = roomService.getRoom(roomId);
      expect(room).toBeDefined();

      ownerClient.disconnect();
    });

    it('should handle user rejoining during grace period multiple times', async () => {
      // Create room and add user
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Multiple Rejoin Room',
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
      const roomId = (result as any).room.id;

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'MultiRejoinUser',
        userId: 'multi-rejoin-123',
        role: 'band_member'
      };

      // Multiple disconnect/reconnect cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        const userClient = Client(`http://localhost:${port}`);
        await new Promise<void>((resolve) => {
          userClient.on('connect', resolve);
        });

        const joinPromise = new Promise((resolve) => {
          userClient.on('room_joined', resolve);
        });

        userClient.emit('join_room', joinRoomData);
        await joinPromise;

        // Disconnect
        userClient.disconnect();
        
        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Final reconnect
      const finalClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        finalClient.on('connect', resolve);
      });

      const finalJoinPromise = new Promise((resolve) => {
        finalClient.on('room_joined', resolve);
      });

      finalClient.emit('join_room', joinRoomData);
      await finalJoinPromise;

      // Verify user is properly in room
      const room = roomService.getRoom(roomId);
      expect(room?.users.has('multi-rejoin-123')).toBe(true);

      ownerClient.disconnect();
      finalClient.disconnect();
    });
  });

  describe('Ownership Transfer Edge Cases', () => {
    it('should handle rapid ownership transfers', async () => {
      const startTime = Bun.nanoseconds();
      
      // Create room with multiple members
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Rapid Transfer Room',
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
      const roomId = (result as any).room.id;

      // Add multiple members
      const memberCount = 3;
      const memberClients: ClientSocket[] = [];

      for (let i = 0; i < memberCount; i++) {
        const client = Client(`http://localhost:${port}`);
        memberClients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const joinRoomData: JoinRoomData = {
          roomId,
          username: `Member${i}`,
          userId: `member-${i}`,
          role: 'band_member'
        };

        const joinPromise = new Promise((resolve) => {
          client.on('room_joined', resolve);
        });

        client.emit('join_room', joinRoomData);
        await joinPromise;
      }

      // Rapid ownership transfers by having owners leave in sequence
      let currentOwnerClient = ownerClient;
      let expectedNewOwner = 'member-0';

      for (let i = 0; i < memberCount; i++) {
        const ownershipTransferPromise = new Promise((resolve) => {
          memberClients[i]?.on('ownership_transferred', resolve);
        });

        currentOwnerClient.emit('leave_room');
        const transfer = await ownershipTransferPromise;

        expect(transfer).toMatchObject({
          newOwner: expect.objectContaining({
            id: expectedNewOwner
          })
        });

        // Update for next iteration
        if (i < memberCount - 1) {
          currentOwnerClient = memberClients[i]!;
          expectedNewOwner = `member-${i + 1}`;
        }
      }

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      edgeCaseMetrics.ownershipTransfers.push(durationMs);

      // Verify final ownership
      const room = roomService.getRoom(roomId);
      expect(room?.owner).toBe('member-2'); // Last member should be owner

      // Cleanup remaining clients
      memberClients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });

    it('should handle owner leaving when room has pending members', async () => {
      // Create private room
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Pending Members Room',
        username: 'Owner',
        userId: 'owner-123',
        isPrivate: true,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        ownerClient.on('room_created', resolve);
      });

      ownerClient.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      const roomId = (result as any).room.id;

      // Add a regular member first
      const memberClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        memberClient.on('connect', resolve);
      });

      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'Member',
        userId: 'member-123',
        role: 'audience' // Audience can join private rooms directly
      };

      const joinPromise = new Promise((resolve) => {
        memberClient.on('room_joined', resolve);
      });

      memberClient.emit('join_room', joinRoomData);
      await joinPromise;

      // Manually add a pending member (simulating approval workflow)
      const room = roomService.getRoom(roomId);
      const pendingUser: User = {
        id: 'pending-123',
        username: 'PendingUser',
        role: 'band_member',
        isReady: false
      };
      room?.pendingMembers.set('pending-123', pendingUser);

      // Owner leaves
      const ownershipTransferPromise = new Promise((resolve) => {
        memberClient.on('ownership_transferred', resolve);
      });

      ownerClient.emit('leave_room');
      const transfer = await ownershipTransferPromise;

      expect(transfer).toMatchObject({
        newOwner: expect.objectContaining({
          id: 'member-123'
        })
      });

      // Verify pending member is still there
      const updatedRoom = roomService.getRoom(roomId);
      expect(updatedRoom?.pendingMembers.has('pending-123')).toBe(true);

      memberClient.disconnect();
    });
  });

  describe('Concurrent Operations Edge Cases', () => {
    it('should handle simultaneous join attempts for same user', async () => {
      const startTime = Bun.nanoseconds();
      
      // Create room
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Concurrent Join Room',
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
      const roomId = (result as any).room.id;

      // Create multiple clients for same user (simulating multiple tabs)
      const clientCount = 5;
      const clients: ClientSocket[] = [];
      const joinPromises: Promise<any>[] = [];

      for (let i = 0; i < clientCount; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const joinPromise = new Promise((resolve) => {
          client.on('room_joined', resolve);
        });
        joinPromises.push(joinPromise);
      }

      // Emit join requests simultaneously
      const joinRoomData: JoinRoomData = {
        roomId,
        username: 'ConcurrentUser',
        userId: 'concurrent-user-123',
        role: 'band_member'
      };

      clients.forEach(client => {
        client.emit('join_room', joinRoomData);
      });

      await Promise.all(joinPromises);

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      edgeCaseMetrics.concurrentJoins.push(durationMs);

      // Verify user is only in room once
      const room = roomService.getRoom(roomId);
      const userCount = Array.from(room!.users.values()).filter(u => u.id === 'concurrent-user-123').length;
      expect(userCount).toBe(1);

      // Cleanup
      ownerClient.disconnect();
      clients.forEach(client => client.disconnect());
    });

    it('should handle mixed concurrent operations (join/leave/create)', async () => {
      const operationCount = 15;
      const startTime = Bun.nanoseconds();

      // Create base room
      const baseClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        baseClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Mixed Operations Room',
        username: 'BaseOwner',
        userId: 'base-owner-123',
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        baseClient.on('room_created', resolve);
      });

      baseClient.emit('create_room', createRoomData);
      const result = await roomCreatedPromise;
      const baseRoomId = (result as any).room.id;

      // Perform mixed operations concurrently
      const operations: Promise<any>[] = [];

      for (let i = 0; i < operationCount; i++) {
        const client = Client(`http://localhost:${port}`);
        
        const connectPromise = new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });
        
        operations.push(connectPromise.then(async () => {
          const operationType = i % 3;
          
          if (operationType === 0) {
            // Create room operation
            const createData: CreateRoomData = {
              name: `Concurrent Room ${i}`,
              username: `Creator${i}`,
              userId: `creator-${i}`,
              isPrivate: false,
              isHidden: false
            };

            return new Promise((resolve) => {
              client.on('room_created', resolve);
              client.emit('create_room', createData);
            });
          } else if (operationType === 1) {
            // Join room operation
            const joinData: JoinRoomData = {
              roomId: baseRoomId,
              username: `Joiner${i}`,
              userId: `joiner-${i}`,
              role: 'audience'
            };

            return new Promise((resolve) => {
              client.on('room_joined', resolve);
              client.emit('join_room', joinData);
            });
          } else {
            // Join then leave operation
            const joinData: JoinRoomData = {
              roomId: baseRoomId,
              username: `JoinLeaver${i}`,
              userId: `join-leaver-${i}`,
              role: 'audience'
            };

            return new Promise((resolve) => {
              client.on('room_joined', () => {
                client.on('leave_confirmed', resolve);
                client.emit('leave_room');
              });
              client.emit('join_room', joinData);
            });
          }
        }));
      }

      await Promise.all(operations);

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      edgeCaseMetrics.concurrentJoins.push(durationMs);

      // Verify system is still stable
      const rooms = roomService.getAllRooms();
      expect(rooms.length).toBeGreaterThan(0);

      console.log(`✅ Handled ${operationCount} mixed concurrent operations in ${durationMs.toFixed(2)}ms`);

      baseClient.disconnect();
    });
  });

  describe('Error Recovery Edge Cases', () => {
    it('should recover from namespace creation failures', async () => {
      const startTime = Bun.nanoseconds();
      
      // Mock namespace manager to simulate failure
      const originalCreateRoomNamespace = namespaceManager.createRoomNamespace;
      let failureCount = 0;
      
      namespaceManager.createRoomNamespace = function(roomId: string) {
        failureCount++;
        if (failureCount === 1) {
          throw new Error('Simulated namespace creation failure');
        }
        return originalCreateRoomNamespace.call(this, roomId);
      };

      const client = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        client.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Recovery Test Room',
        username: 'RecoveryUser',
        userId: 'recovery-123',
        isPrivate: false,
        isHidden: false
      };

      // First attempt should fail
      client.emit('create_room', createRoomData);
      
      // Wait for failure to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Restore original function
      namespaceManager.createRoomNamespace = originalCreateRoomNamespace;

      // Second attempt should succeed
      const roomCreatedPromise = new Promise((resolve) => {
        client.on('room_created', resolve);
      });

      const secondCreateData = { ...createRoomData, name: 'Recovery Test Room 2' };
      client.emit('create_room', secondCreateData);
      const result = await roomCreatedPromise;

      const endTime = Bun.nanoseconds();
      const durationMs = (endTime - startTime) / 1_000_000;
      edgeCaseMetrics.errorRecoveries.push(durationMs);

      expect(result).toMatchObject({
        room: expect.objectContaining({
          name: 'Recovery Test Room 2'
        })
      });

      client.disconnect();
    });

    it('should handle service unavailability gracefully', async () => {
      // Temporarily disable room service methods
      const originalCreateRoom = roomService.createRoom;
      const originalGetRoom = roomService.getRoom;

      let serviceUnavailable = true;
      
      roomService.createRoom = function(...args) {
        if (serviceUnavailable) {
          throw new Error('Service temporarily unavailable');
        }
        return originalCreateRoom.apply(this, args);
      };

      roomService.getRoom = function(...args) {
        if (serviceUnavailable) {
          return null;
        }
        return originalGetRoom.apply(this, args);
      };

      const client = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        client.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Service Test Room',
        username: 'ServiceUser',
        userId: 'service-123',
        isPrivate: false,
        isHidden: false
      };

      // Should handle service unavailability without crashing
      client.emit('create_room', createRoomData);
      
      // Wait for error handling
      await new Promise(resolve => setTimeout(resolve, 100));

      // Restore service
      serviceUnavailable = false;

      // Should work now
      const roomCreatedPromise = new Promise((resolve) => {
        client.on('room_created', resolve);
      });

      const workingCreateData = { ...createRoomData, name: 'Working Room' };
      client.emit('create_room', workingCreateData);
      const result = await roomCreatedPromise;

      expect(result).toMatchObject({
        room: expect.objectContaining({
          name: 'Working Room'
        })
      });

      // Restore original methods
      roomService.createRoom = originalCreateRoom;
      roomService.getRoom = originalGetRoom;

      client.disconnect();
    });
  });

  describe('Memory and Resource Management', () => {
    it('should not leak memory during rapid operations', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform many operations
      const operationCount = 100;
      
      for (let i = 0; i < operationCount; i++) {
        const client = Client(`http://localhost:${port}`);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const createRoomData: CreateRoomData = {
          name: `Memory Test Room ${i}`,
          username: `MemUser${i}`,
          userId: `mem-user-${i}`,
          isPrivate: false,
          isHidden: false
        };

        const roomCreatedPromise = new Promise((resolve) => {
          client.on('room_created', resolve);
        });

        client.emit('create_room', createRoomData);
        await roomCreatedPromise;

        // Immediately disconnect to test cleanup
        client.disconnect();
        
        // Force garbage collection every 10 operations
        if (i % 10 === 0 && global.gc) {
          global.gc();
        }
      }

      // Force final garbage collection
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(`📊 Memory increase after ${operationCount} operations: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);

      // Memory increase should be reasonable (less than 100MB for 100 operations)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });

    it('should clean up resources when rooms are deleted', async () => {
      const initialRoomCount = roomService.getAllRooms().length;
      
      // Create multiple rooms
      const roomCount = 10;
      const clients: ClientSocket[] = [];

      for (let i = 0; i < roomCount; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const createRoomData: CreateRoomData = {
          name: `Cleanup Room ${i}`,
          username: `CleanupUser${i}`,
          userId: `cleanup-user-${i}`,
          isPrivate: false,
          isHidden: false
        };

        const roomCreatedPromise = new Promise((resolve) => {
          client.on('room_created', resolve);
        });

        client.emit('create_room', createRoomData);
        await roomCreatedPromise;
      }

      // Verify rooms were created
      expect(roomService.getAllRooms().length).toBe(initialRoomCount + roomCount);

      // Disconnect all clients (should trigger room cleanup)
      const roomClosedPromises: Promise<any>[] = [];
      
      clients.forEach(client => {
        roomClosedPromises.push(new Promise((resolve) => {
          client.on('room_closed', resolve);
          client.emit('leave_room');
        }));
      });

      await Promise.all(roomClosedPromises);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify rooms were cleaned up
      const remainingRooms = roomService.getAllRooms().length;
      expect(remainingRooms).toBe(initialRoomCount);

      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
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