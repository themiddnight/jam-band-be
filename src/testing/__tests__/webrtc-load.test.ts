/**
 * WebRTC mesh performance tests under load
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { LoadTestHarness, LoadTestConfig } from '../LoadTestHarness';
import { performanceMetrics } from '../../shared/infrastructure/monitoring';

describe('WebRTC Mesh Load Tests', () => {
  let loadTestHarness: LoadTestHarness;

  beforeAll(() => {
    loadTestHarness = new LoadTestHarness();
  });

  afterAll(() => {
    performanceMetrics.clearMetrics('webrtc-load-test');
  });

  it('should handle WebRTC connection establishment under load', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 20, // Simulate 20 users trying to connect simultaneously
      testDurationMs: 15000, // 15 seconds
      rampUpTimeMs: 2000,    // 2 seconds ramp-up
      operations: [
        {
          name: 'establishConnection',
          weight: 40,
          execute: async () => {
            // Simulate WebRTC connection establishment
            const startTime = Bun.nanoseconds();
            
            // Mock ICE candidate gathering (typically 100-500ms)
            await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 100));
            
            // Mock offer/answer exchange (typically 50-200ms)
            await new Promise(resolve => setTimeout(resolve, Math.random() * 150 + 50));
            
            // Mock connection establishment (typically 100-800ms)
            await new Promise(resolve => setTimeout(resolve, Math.random() * 700 + 100));
            
            const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
            
            // WebRTC connections should establish within reasonable time
            if (duration > 2000) { // 2 seconds
              throw new Error(`WebRTC connection took too long: ${duration}ms`);
            }
          }
        },
        {
          name: 'sendOffer',
          weight: 25,
          execute: async () => {
            // Simulate sending WebRTC offer
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 20));
          }
        },
        {
          name: 'sendAnswer',
          weight: 25,
          execute: async () => {
            // Simulate sending WebRTC answer
            await new Promise(resolve => setTimeout(resolve, Math.random() * 80 + 15));
          }
        },
        {
          name: 'sendIceCandidate',
          weight: 10,
          execute: async () => {
            // Simulate ICE candidate exchange
            await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 5));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // WebRTC operations should maintain low latency
    expect(results.errorRate).toBeLessThan(0.1); // Less than 10% error rate (WebRTC can be flaky)
    expect(results.averageResponseTime).toBeLessThan(500); // Less than 500ms average
    
    // Connection establishment should not be too slow
    const connectionStats = results.operationStats.find(s => s.operation === 'establishConnection');
    if (connectionStats) {
      expect(connectionStats.averageTime).toBeLessThan(1500); // Less than 1.5s average
    }
    
    console.log('🔗 WebRTC Connection Load Test Report:', loadTestHarness.generateReport());
  }, 30000);

  it('should handle mesh topology creation with multiple users', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 8, // Simulate 8-user mesh (28 connections total)
      testDurationMs: 10000, // 10 seconds
      rampUpTimeMs: 1000,    // 1 second ramp-up
      operations: [
        {
          name: 'joinMesh',
          weight: 30,
          execute: async () => {
            // Simulate joining mesh network
            const existingUsers = Math.floor(Math.random() * 7); // 0-7 existing users
            const connectionsToEstablish = existingUsers;
            
            // Each new user must connect to all existing users
            for (let i = 0; i < connectionsToEstablish; i++) {
              await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));
            }
          }
        },
        {
          name: 'maintainConnection',
          weight: 50,
          execute: async () => {
            // Simulate maintaining existing connections
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
          }
        },
        {
          name: 'leaveMesh',
          weight: 20,
          execute: async () => {
            // Simulate leaving mesh (closing all connections)
            const connectionsToClose = Math.floor(Math.random() * 7) + 1;
            
            for (let i = 0; i < connectionsToClose; i++) {
              await new Promise(resolve => setTimeout(resolve, Math.random() * 30 + 5));
            }
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // Mesh operations should be efficient
    expect(results.errorRate).toBeLessThan(0.15); // Less than 15% error rate
    expect(results.averageResponseTime).toBeLessThan(300); // Less than 300ms average
    
    // Joining mesh should scale reasonably
    const joinStats = results.operationStats.find(s => s.operation === 'joinMesh');
    if (joinStats) {
      expect(joinStats.averageTime).toBeLessThan(1000); // Less than 1s average
    }
    
    console.log('🕸️ WebRTC Mesh Topology Load Test Report:', loadTestHarness.generateReport());
  }, 25000);

  it('should handle audio data transmission simulation', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 12, // 12 users in mesh
      testDurationMs: 8000,  // 8 seconds
      rampUpTimeMs: 1000,    // 1 second ramp-up
      operations: [
        {
          name: 'sendAudioData',
          weight: 60,
          execute: async () => {
            // Simulate sending audio data (typically every 20ms for 50fps)
            await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 5));
            
            // Simulate network latency
            const networkLatency = Math.random() * 50 + 10; // 10-60ms
            if (networkLatency > 100) {
              throw new Error('Network latency too high');
            }
          }
        },
        {
          name: 'receiveAudioData',
          weight: 40,
          execute: async () => {
            // Simulate receiving and processing audio data
            await new Promise(resolve => setTimeout(resolve, Math.random() * 15 + 5));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);

    // Audio transmission should be very low latency
    expect(results.errorRate).toBeLessThan(0.05); // Less than 5% error rate
    expect(results.averageResponseTime).toBeLessThan(50); // Less than 50ms average
    
    // Audio operations should be consistently fast
    results.operationStats.forEach(stat => {
      expect(stat.averageTime).toBeLessThan(100); // All audio operations under 100ms
    });
    
    console.log('🎵 Audio Data Transmission Load Test Report:', loadTestHarness.generateReport());
  }, 20000);

  it('should detect performance bottlenecks in WebRTC operations', async () => {
    const config: LoadTestConfig = {
      concurrentUsers: 15,
      testDurationMs: 12000, // 12 seconds
      rampUpTimeMs: 1500,    // 1.5 seconds ramp-up
      operations: [
        {
          name: 'fastOperation',
          weight: 70,
          execute: async () => {
            await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 5));
          }
        },
        {
          name: 'slowOperation',
          weight: 20,
          execute: async () => {
            // Intentionally slow operation to test bottleneck detection
            await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 200));
          }
        },
        {
          name: 'flakyOperation',
          weight: 10,
          execute: async () => {
            // Intentionally flaky operation
            if (Math.random() < 0.3) {
              throw new Error('Simulated WebRTC failure');
            }
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
          }
        }
      ]
    };

    const results = await loadTestHarness.runLoadTest(config);
    const report = JSON.parse(loadTestHarness.generateReport());

    // Should detect slow operations
    expect(report.recommendations).toContain(
      expect.stringMatching(/slow.*slowOperation/i)
    );

    // Should detect high error rate operations
    expect(report.recommendations).toContain(
      expect.stringMatching(/error rate.*flakyOperation/i)
    );

    // Fast operations should perform well
    const fastStats = results.operationStats.find(s => s.operation === 'fastOperation');
    if (fastStats) {
      expect(fastStats.averageTime).toBeLessThan(50);
      expect(fastStats.errorCount).toBe(0);
    }

    console.log('🔍 WebRTC Bottleneck Detection Report:', loadTestHarness.generateReport());
  }, 25000);
});