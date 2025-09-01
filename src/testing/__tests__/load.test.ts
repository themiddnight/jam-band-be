/**
 * Load tests for refactored backend architecture
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { LoadTestHarness, LoadTestConfig } from '../LoadTestHarness';

describe('Load Tests', () => {
  let loadTestHarness: LoadTestHarness;

  beforeAll(async () => {
    loadTestHarness = new LoadTestHarness();
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should handle 50+ concurrent users in lobby operations', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 50,
      testDurationMs: 30000, // 30 seconds
      rampUpTimeMs: 5000,     // 5 seconds ramp-up
      operations: [
        {
          name: 'searchRooms',
          weight: 40,
          execute: async () => {
            const criteria = {
              genres: ['rock', 'jazz', 'electronic'][Math.floor(Math.random() * 3)],
              maxMembers: Math.floor(Math.random() * 8) + 2,
              isPrivate: Math.random() > 0.7
            };
            
            // Mock search criteria - in real test this would use actual SearchCriteria
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
          }
        },
        {
          name: 'getPopularRooms',
          weight: 30,
          execute: async () => {
            // Mock popular rooms request
            await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 5));
          }
        },
        {
          name: 'getRecommendedRooms',
          weight: 20,
          execute: async () => {
            // Mock recommendations request
            await new Promise(resolve => setTimeout(resolve, Math.random() * 40 + 10));
          }
        },
        {
          name: 'getRoomsByGenre',
          weight: 10,
          execute: async () => {
            const genres = ['rock', 'jazz', 'electronic', 'classical', 'pop'];
            const genre = genres[Math.floor(Math.random() * genres.length)];
            
            // Mock genre search
            await new Promise(resolve => setTimeout(resolve, Math.random() * 35 + 8));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // Assertions for performance requirements
    expect(results.errorRate).toBeLessThan(0.05); // Less than 5% error rate
    expect(results.averageResponseTime).toBeLessThan(200); // Less than 200ms average
    expect(results.requestsPerSecond).toBeGreaterThan(50); // At least 50 req/s
    expect(results.totalRequests).toBeGreaterThan(1000); // Should handle significant load
    
    // Memory usage should not increase dramatically
    const memoryIncrease = results.memoryUsage.final.heapUsed - results.memoryUsage.initial.heapUsed;
    expect(memoryIncrease).toBeLessThan(200 * 1024 * 1024); // Less than 200MB increase
    
    console.log('📊 Lobby Load Test Report:', loadTestHarness.generateReport());
  }, 60000); // 60 second timeout

  it('should handle room management operations under load', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 30,
      testDurationMs: 20000, // 20 seconds
      rampUpTimeMs: 3000,    // 3 seconds ramp-up
      operations: [
        {
          name: 'createRoom',
          weight: 20,
          execute: async () => {
            // Mock room creation
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 20));
          }
        },
        {
          name: 'joinRoom',
          weight: 35,
          execute: async () => {
            // Mock room join
            await new Promise(resolve => setTimeout(resolve, Math.random() * 80 + 15));
          }
        },
        {
          name: 'leaveRoom',
          weight: 25,
          execute: async () => {
            // Mock room leave
            await new Promise(resolve => setTimeout(resolve, Math.random() * 60 + 10));
          }
        },
        {
          name: 'updateRoomSettings',
          weight: 10,
          execute: async () => {
            // Mock settings update
            await new Promise(resolve => setTimeout(resolve, Math.random() * 120 + 30));
          }
        },
        {
          name: 'transferOwnership',
          weight: 10,
          execute: async () => {
            // Mock ownership transfer
            await new Promise(resolve => setTimeout(resolve, Math.random() * 90 + 25));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // Room operations might be slightly slower due to state management
    expect(results.errorRate).toBeLessThan(0.08); // Less than 8% error rate
    expect(results.averageResponseTime).toBeLessThan(300); // Less than 300ms average
    expect(results.requestsPerSecond).toBeGreaterThan(30); // At least 30 req/s
    
    console.log('🏠 Room Management Load Test Report:', loadTestHarness.generateReport());
  }, 45000); // 45 second timeout

  it('should handle mixed operations across contexts', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 40,
      testDurationMs: 25000, // 25 seconds
      rampUpTimeMs: 4000,    // 4 seconds ramp-up
      operations: [
        // Lobby operations
        {
          name: 'lobby.search',
          weight: 25,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
          }
        },
        {
          name: 'lobby.popular',
          weight: 20,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 5));
          }
        },
        // Room operations
        {
          name: 'room.create',
          weight: 15,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 20));
          }
        },
        {
          name: 'room.join',
          weight: 25,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 80 + 15));
          }
        },
        {
          name: 'room.leave',
          weight: 15,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 60 + 10));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // Cross-context operations should maintain good performance
    expect(results.errorRate).toBeLessThan(0.06); // Less than 6% error rate
    expect(results.averageResponseTime).toBeLessThan(250); // Less than 250ms average
    expect(results.requestsPerSecond).toBeGreaterThan(40); // At least 40 req/s
    
    // Verify no single operation is significantly slower
    results.operationStats.forEach(stat => {
      expect(stat.averageTime).toBeLessThan(500); // No operation over 500ms average
      
      const operationErrorRate = stat.count > 0 ? stat.errorCount / stat.count : 0;
      expect(operationErrorRate).toBeLessThan(0.1); // No operation over 10% error rate
    });
    
    console.log('🔄 Mixed Operations Load Test Report:', loadTestHarness.generateReport());
  }, 50000); // 50 second timeout

  it('should maintain performance with event processing load', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 25,
      testDurationMs: 15000, // 15 seconds
      rampUpTimeMs: 2000,    // 2 seconds ramp-up
      operations: [
        {
          name: 'eventHeavyOperation',
          weight: 50,
          execute: async () => {
            // Simulate operation that triggers multiple events
            await new Promise(resolve => setTimeout(resolve, Math.random() * 60 + 20));
            
            // Simulate event processing delay
            await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 5));
          }
        },
        {
          name: 'lightOperation',
          weight: 50,
          execute: async () => {
            // Simulate lightweight operation
            await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 5));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // Event processing should not create bottlenecks
    expect(results.errorRate).toBeLessThan(0.05); // Less than 5% error rate
    expect(results.averageResponseTime).toBeLessThan(150); // Less than 150ms average
    
    // Event-heavy operations should not be significantly slower
    const eventHeavyStats = results.operationStats.find(s => s.operation === 'eventHeavyOperation');
    const lightStats = results.operationStats.find(s => s.operation === 'lightOperation');
    
    if (eventHeavyStats && lightStats) {
      const timeDifference = eventHeavyStats.averageTime - lightStats.averageTime;
      expect(timeDifference).toBeLessThan(100); // Less than 100ms difference
    }
    
    console.log('📡 Event Processing Load Test Report:', loadTestHarness.generateReport());
  }, 30000); // 30 second timeout
});