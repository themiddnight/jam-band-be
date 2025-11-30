/**
 * Performance Benchmarks for RoomLifecycleHandler using Bun's Built-in Performance APIs
 * Comprehensive performance testing with regression detection
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
import { CreateRoomData, JoinRoomData } from '../../types';

// Performance thresholds (in milliseconds)
const PERFORMANCE_THRESHOLDS = {
  ROOM_CREATION: 10,
  ROOM_JOIN: 5,
  ROOM_LEAVE: 5,
  OWNERSHIP_TRANSFER: 15,
  CONCURRENT_OPERATIONS: 500,
  MEMORY_LIMIT_MB: 50
};

// Performance metrics collection
interface DetailedPerformanceMetrics {
  operation: string;
  duration: number;
  timestamp: number;
  memoryBefore: number;
  memoryAfter: number;
  metadata?: any;
}

describe.skip('RoomLifecycleHandler - Performance Benchmarks', () => {
  let io: Server;
  let roomLifecycleHandler: RoomLifecycleHandler;
  let roomService: RoomService;
  let namespaceManager: NamespaceManager;
  let roomSessionManager: RoomSessionManager;
  let httpServer: any;
  let port: number;

  // Performance tracking
  let performanceData: DetailedPerformanceMetrics[] = [];
  let baselineMetrics: Map<string, number> = new Map();

  beforeAll(() => {
    console.log('🚀 Starting Performance Benchmarks with Bun APIs');
    console.log('Performance Thresholds:');
    console.log(`  Room Creation: ${PERFORMANCE_THRESHOLDS.ROOM_CREATION}ms`);
    console.log(`  Room Join: ${PERFORMANCE_THRESHOLDS.ROOM_JOIN}ms`);
    console.log(`  Room Leave: ${PERFORMANCE_THRESHOLDS.ROOM_LEAVE}ms`);
    console.log(`  Ownership Transfer: ${PERFORMANCE_THRESHOLDS.OWNERSHIP_TRANSFER}ms`);
    console.log(`  Concurrent Ops: ${PERFORMANCE_THRESHOLDS.CONCURRENT_OPERATIONS}ms`);
    console.log(`  Memory Limit: ${PERFORMANCE_THRESHOLDS.MEMORY_LIMIT_MB}MB\n`);
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
    // Close server with timeout
    if (io) {
      io.close();
    }
    
    if (httpServer) {
      await Promise.race([
        new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)) // 2s timeout
      ]);
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(() => {
    // Generate comprehensive performance report
    generatePerformanceReport();
  });

  describe('Single Operation Performance', () => {
    it('should create room within performance threshold', async () => {
      const client = Client(`http://localhost:${port}`);
      await Promise.race([
        new Promise<void>((resolve) => {
          client.on('connect', resolve);
        }),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]);

      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();

      const createRoomData: CreateRoomData = {
        name: 'Performance Test Room',
        username: 'PerfUser',
        userId: 'perf-123',
        roomType: 'perform' as const,
        isPrivate: false,
        isHidden: false
      };

      const roomCreatedPromise = new Promise((resolve) => {
        client.on('room_created', resolve);
      });

      client.emit('create_room', createRoomData);
      await roomCreatedPromise;

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const durationMs = (endTime - startTime) / 1_000_000;

      // Record performance data
      recordPerformanceMetric({
        operation: 'room_creation',
        duration: durationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: { roomName: createRoomData.name }
      });

      // Performance assertions
      expect(durationMs).toBeLessThan(PERFORMANCE_THRESHOLDS.ROOM_CREATION);
      
      const memoryIncreaseMB = (memoryAfter - memoryBefore) / 1024 / 1024;
      expect(memoryIncreaseMB).toBeLessThan(5); // Should not use more than 5MB per room

      console.log(`✅ Room creation: ${durationMs.toFixed(2)}ms (threshold: ${PERFORMANCE_THRESHOLDS.ROOM_CREATION}ms)`);

      client.disconnect();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for cleanup
    });

    it('should join room within performance threshold', async () => {
      // Create room first
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Join Perf Room',
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
      const roomId = (result as any).room.id;

      // Test join performance
      const joinerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        joinerClient.on('connect', resolve);
      });

      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();

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
      await roomJoinedPromise;

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const durationMs = (endTime - startTime) / 1_000_000;

      recordPerformanceMetric({
        operation: 'room_join',
        duration: durationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: { roomId, role: joinRoomData.role }
      });

      expect(durationMs).toBeLessThan(PERFORMANCE_THRESHOLDS.ROOM_JOIN);

      console.log(`✅ Room join: ${durationMs.toFixed(2)}ms (threshold: ${PERFORMANCE_THRESHOLDS.ROOM_JOIN}ms)`);

      ownerClient.disconnect();
      joinerClient.disconnect();
    });

    it('should leave room within performance threshold', async () => {
      // Setup room with user
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Leave Perf Room',
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
      const roomId = (result as any).room.id;

      const memberClient = Client(`http://localhost:${port}`);
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

      // Test leave performance
      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();

      const leaveConfirmedPromise = new Promise((resolve) => {
        memberClient.on('leave_confirmed', resolve);
      });

      memberClient.emit('leave_room');
      await leaveConfirmedPromise;

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const durationMs = (endTime - startTime) / 1_000_000;

      recordPerformanceMetric({
        operation: 'room_leave',
        duration: durationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: { roomId, userRole: 'member' }
      });

      expect(durationMs).toBeLessThan(PERFORMANCE_THRESHOLDS.ROOM_LEAVE);

      console.log(`✅ Room leave: ${durationMs.toFixed(2)}ms (threshold: ${PERFORMANCE_THRESHOLDS.ROOM_LEAVE}ms)`);

      ownerClient.disconnect();
      memberClient.disconnect();
    });

    it('should handle ownership transfer within performance threshold', async () => {
      // Setup room with owner and member
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Ownership Perf Room',
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
      const roomId = (result as any).room.id;

      const memberClient = Client(`http://localhost:${port}`);
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

      // Test ownership transfer performance
      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();

      const ownershipTransferredPromise = new Promise((resolve) => {
        memberClient.on('ownership_transferred', resolve);
      });

      ownerClient.emit('leave_room');
      await ownershipTransferredPromise;

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const durationMs = (endTime - startTime) / 1_000_000;

      recordPerformanceMetric({
        operation: 'ownership_transfer',
        duration: durationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: { roomId, fromOwner: 'owner-123', toOwner: 'member-123' }
      });

      expect(durationMs).toBeLessThan(PERFORMANCE_THRESHOLDS.OWNERSHIP_TRANSFER);

      console.log(`✅ Ownership transfer: ${durationMs.toFixed(2)}ms (threshold: ${PERFORMANCE_THRESHOLDS.OWNERSHIP_TRANSFER}ms)`);

      memberClient.disconnect();
    });
  });

  describe('Concurrent Operations Performance', () => {
    it('should handle concurrent room creations efficiently', async () => {
      const concurrentCount = 25;
      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();

      // Create clients
      const clients: ClientSocket[] = [];
      for (let i = 0; i < concurrentCount; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });
      }

      // Perform concurrent room creations
      const promises: Promise<any>[] = [];
      for (let i = 0; i < concurrentCount; i++) {
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
            isPrivate: i % 3 === 0,
            isHidden: i % 5 === 0
          };

          client.emit('create_room', createRoomData);
        }
      }

      await Promise.all(promises);

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const totalDurationMs = (endTime - startTime) / 1_000_000;
      const avgDurationMs = totalDurationMs / concurrentCount;

      recordPerformanceMetric({
        operation: 'concurrent_room_creation',
        duration: totalDurationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: { 
          concurrentCount, 
          avgDuration: avgDurationMs,
          operationsPerSecond: (concurrentCount / totalDurationMs) * 1000
        }
      });

      expect(totalDurationMs).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_OPERATIONS);

      const memoryIncreaseMB = (memoryAfter - memoryBefore) / 1024 / 1024;
      expect(memoryIncreaseMB).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT_MB);

      console.log(`✅ Concurrent room creation: ${totalDurationMs.toFixed(2)}ms total, ${avgDurationMs.toFixed(2)}ms avg`);
      console.log(`   Operations/sec: ${((concurrentCount / totalDurationMs) * 1000).toFixed(2)}`);

      // Cleanup
      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });

    it('should handle concurrent joins to same room efficiently', async () => {
      // Create room first
      const ownerClient = Client(`http://localhost:${port}`);
      await new Promise<void>((resolve) => {
        ownerClient.on('connect', resolve);
      });

      const createRoomData: CreateRoomData = {
        name: 'Concurrent Join Room',
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
      const roomId = (result as any).room.id;

      // Concurrent joins
      const concurrentCount = 20;
      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();

      const clients: ClientSocket[] = [];
      for (let i = 0; i < concurrentCount; i++) {
        const client = Client(`http://localhost:${port}`);
        clients.push(client);
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });
      }

      const joinPromises: Promise<any>[] = [];
      for (let i = 0; i < concurrentCount; i++) {
        const client = clients[i];
        if (client) {
          const promise = new Promise((resolve) => {
            client.on('room_joined', resolve);
          });
          joinPromises.push(promise);

          const joinRoomData: JoinRoomData = {
            roomId,
            username: `ConcurrentUser${i}`,
            userId: `concurrent-user-${i}`,
            role: i % 2 === 0 ? 'audience' : 'band_member'
          };

          client.emit('join_room', joinRoomData);
        }
      }

      await Promise.all(joinPromises);

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const totalDurationMs = (endTime - startTime) / 1_000_000;
      const avgDurationMs = totalDurationMs / concurrentCount;

      recordPerformanceMetric({
        operation: 'concurrent_room_join',
        duration: totalDurationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: { 
          concurrentCount, 
          avgDuration: avgDurationMs,
          roomId,
          operationsPerSecond: (concurrentCount / totalDurationMs) * 1000
        }
      });

      expect(totalDurationMs).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_OPERATIONS);

      // Verify all users joined
      const room = roomService.getRoom(roomId);
      expect(room?.users.size).toBe(concurrentCount + 1); // +1 for owner

      console.log(`✅ Concurrent room joins: ${totalDurationMs.toFixed(2)}ms total, ${avgDurationMs.toFixed(2)}ms avg`);
      console.log(`   Operations/sec: ${((concurrentCount / totalDurationMs) * 1000).toFixed(2)}`);

      // Cleanup
      ownerClient.disconnect();
      clients.forEach(client => {
        if (client && client.connected) {
          client.disconnect();
        }
      });
    });
  });

  describe('Load Testing', () => {
    it('should maintain performance under sustained load', async () => {
      const loadDurationMs = 5000; // 5 seconds of load
      const operationsPerSecond = 10;
      const totalOperations = Math.floor((loadDurationMs / 1000) * operationsPerSecond);

      console.log(`🔥 Starting sustained load test: ${operationsPerSecond} ops/sec for ${loadDurationMs/1000}s`);

      const memoryBefore = process.memoryUsage().heapUsed;
      const startTime = Bun.nanoseconds();
      
      let completedOperations = 0;
      const operationTimes: number[] = [];

      const performOperation = async (operationIndex: number): Promise<void> => {
        const opStartTime = Bun.nanoseconds();
        
        const client = Client(`http://localhost:${port}`);
        await new Promise<void>((resolve) => {
          client.on('connect', resolve);
        });

        const createRoomData: CreateRoomData = {
          name: `Load Test Room ${operationIndex}`,
          username: `LoadUser${operationIndex}`,
          userId: `load-user-${operationIndex}`,
          isPrivate: false,
          isHidden: false
        };

        const roomCreatedPromise = new Promise((resolve) => {
          client.on('room_created', resolve);
        });

        client.emit('create_room', createRoomData);
        await roomCreatedPromise;

        client.disconnect();

        const opEndTime = Bun.nanoseconds();
        const opDurationMs = (opEndTime - opStartTime) / 1_000_000;
        operationTimes.push(opDurationMs);
        completedOperations++;
      };

      // Execute operations with controlled timing
      const operationPromises: Promise<void>[] = [];
      const intervalMs = 1000 / operationsPerSecond;

      for (let i = 0; i < totalOperations; i++) {
        const delay = i * intervalMs;
        operationPromises.push(
          new Promise(resolve => setTimeout(resolve, delay)).then(() => performOperation(i))
        );
      }

      await Promise.all(operationPromises);

      const endTime = Bun.nanoseconds();
      const memoryAfter = process.memoryUsage().heapUsed;
      const totalDurationMs = (endTime - startTime) / 1_000_000;

      // Calculate performance statistics
      const avgOperationTime = operationTimes.reduce((sum, time) => sum + time, 0) / operationTimes.length;
      const maxOperationTime = Math.max(...operationTimes);
      const minOperationTime = Math.min(...operationTimes);
      const actualOpsPerSecond = (completedOperations / totalDurationMs) * 1000;

      recordPerformanceMetric({
        operation: 'sustained_load_test',
        duration: totalDurationMs,
        timestamp: Date.now(),
        memoryBefore,
        memoryAfter,
        metadata: {
          targetOpsPerSecond: operationsPerSecond,
          actualOpsPerSecond,
          completedOperations,
          avgOperationTime,
          maxOperationTime,
          minOperationTime,
          memoryIncreaseMB: (memoryAfter - memoryBefore) / 1024 / 1024
        }
      });

      // Performance assertions
      expect(avgOperationTime).toBeLessThan(PERFORMANCE_THRESHOLDS.ROOM_CREATION * 2); // Allow 2x threshold under load
      expect(actualOpsPerSecond).toBeGreaterThan(operationsPerSecond * 0.8); // Should achieve at least 80% of target

      const memoryIncreaseMB = (memoryAfter - memoryBefore) / 1024 / 1024;
      expect(memoryIncreaseMB).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_LIMIT_MB * 2); // Allow 2x memory under load

      console.log(`✅ Sustained load test completed:`);
      console.log(`   Target: ${operationsPerSecond} ops/sec, Actual: ${actualOpsPerSecond.toFixed(2)} ops/sec`);
      console.log(`   Avg operation time: ${avgOperationTime.toFixed(2)}ms`);
      console.log(`   Min/Max operation time: ${minOperationTime.toFixed(2)}ms / ${maxOperationTime.toFixed(2)}ms`);
      console.log(`   Memory increase: ${memoryIncreaseMB.toFixed(2)}MB`);
    });
  });

  describe('Memory Performance', () => {
    it('should not leak memory during repeated operations', async () => {
      const iterations = 50;
      const memorySnapshots: number[] = [];

      console.log(`🧠 Memory leak test: ${iterations} iterations`);

      for (let i = 0; i < iterations; i++) {
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

        // Leave room immediately to test cleanup
        const leaveConfirmedPromise = new Promise((resolve) => {
          client.on('leave_confirmed', resolve);
        });

        client.emit('leave_room');
        await leaveConfirmedPromise;

        client.disconnect();

        // Force garbage collection every 10 iterations
        if (i % 10 === 0 && global.gc) {
          global.gc();
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }
      }

      // Final garbage collection and memory check
      if (global.gc) {
        global.gc();
      }
      memorySnapshots.push(process.memoryUsage().heapUsed);

      // Analyze memory trend
      const initialMemory = memorySnapshots[0] || 0;
      const finalMemory = memorySnapshots[memorySnapshots.length - 1] || 0;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

      recordPerformanceMetric({
        operation: 'memory_leak_test',
        duration: 0, // Not time-based
        timestamp: Date.now(),
        memoryBefore: initialMemory,
        memoryAfter: finalMemory,
        metadata: {
          iterations,
          memoryIncreaseMB,
          memorySnapshots: memorySnapshots.map(m => (m / 1024 / 1024).toFixed(2))
        }
      });

      // Memory should not increase significantly
      expect(memoryIncreaseMB).toBeLessThan(20); // Less than 20MB increase

      console.log(`✅ Memory leak test: ${memoryIncreaseMB.toFixed(2)}MB increase over ${iterations} iterations`);
    });
  });

  // Helper functions
  function recordPerformanceMetric(metric: DetailedPerformanceMetrics): void {
    performanceData.push(metric);
    
    // Update baseline if this is the first measurement of this operation
    if (!baselineMetrics.has(metric.operation)) {
      baselineMetrics.set(metric.operation, metric.duration);
    }
  }

  function generatePerformanceReport(): void {
    console.log('\n📊 Comprehensive Performance Report');
    console.log('=====================================');

    // Group metrics by operation
    const operationGroups = new Map<string, DetailedPerformanceMetrics[]>();
    performanceData.forEach(metric => {
      if (!operationGroups.has(metric.operation)) {
        operationGroups.set(metric.operation, []);
      }
      operationGroups.get(metric.operation)!.push(metric);
    });

    // Generate report for each operation
    operationGroups.forEach((metrics, operation) => {
      const durations = metrics.map(m => m.duration).filter(d => d > 0);
      if (durations.length === 0) return;

      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] || 0;

      console.log(`\n🔍 ${operation.toUpperCase().replace(/_/g, ' ')}:`);
      console.log(`   Samples: ${durations.length}`);
      console.log(`   Average: ${avg.toFixed(2)}ms`);
      console.log(`   Median: ${median.toFixed(2)}ms`);
      console.log(`   Min/Max: ${min.toFixed(2)}ms / ${max.toFixed(2)}ms`);

      // Performance regression check
      const baseline = baselineMetrics.get(operation);
      if (baseline && avg > baseline * 1.2) {
        console.log(`   ⚠️  REGRESSION: ${((avg / baseline - 1) * 100).toFixed(1)}% slower than baseline`);
      } else if (baseline) {
        console.log(`   ✅ Performance: ${((1 - avg / baseline) * 100).toFixed(1)}% improvement over baseline`);
      }

      // Memory analysis for operations that track memory
      const memoryMetrics = metrics.filter(m => m.memoryBefore && m.memoryAfter);
      if (memoryMetrics.length > 0) {
        const avgMemoryIncrease = memoryMetrics.reduce((sum, m) => 
          sum + (m.memoryAfter - m.memoryBefore), 0) / memoryMetrics.length;
        console.log(`   Memory: ${(avgMemoryIncrease / 1024 / 1024).toFixed(2)}MB avg increase`);
      }
    });

    console.log('\n=====================================');

    // Export detailed metrics to file for further analysis
    const reportData = {
      timestamp: new Date().toISOString(),
      thresholds: PERFORMANCE_THRESHOLDS,
      metrics: performanceData,
      summary: Array.from(operationGroups.entries()).map(([operation, metrics]) => {
        const durations = metrics.map(m => m.duration).filter(d => d > 0);
        return {
          operation,
          sampleCount: durations.length,
          averageDuration: durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
          minDuration: durations.length > 0 ? Math.min(...durations) : 0,
          maxDuration: durations.length > 0 ? Math.max(...durations) : 0
        };
      })
    };

    // In a real Bun environment, you could write this to a file
    // await Bun.write('performance-report.json', JSON.stringify(reportData, null, 2));
    console.log('\n📄 Performance data collected for analysis');
  }
});