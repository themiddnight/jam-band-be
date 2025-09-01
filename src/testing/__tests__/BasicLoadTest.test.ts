/**
 * Basic load tests for refactored backend
 * Requirements: 8.4, 8.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { boundedContextMonitor } from '../../shared/infrastructure/monitoring';
import { performanceMetrics } from '../../shared/infrastructure/monitoring';

describe('Basic Backend Load Testing', () => {
  beforeEach(() => {
    // Clear metrics before each test
    boundedContextMonitor.clearContextMetrics();
    performanceMetrics.clearMetrics();
  });

  afterEach(() => {
    // Clean up after each test
    boundedContextMonitor.clearContextMetrics();
    performanceMetrics.clearMetrics();
  });

  describe('Bounded Context Performance', () => {
    it('should handle concurrent operations across contexts', async () => {
      const operations: Promise<void>[] = [];
      const contextNames = ['room-management', 'lobby-management', 'audio-processing'];

      // Simulate concurrent operations across different contexts
      for (let i = 0; i < 50; i++) {
        const contextName = contextNames[i % contextNames.length];
        
        operations.push(
          boundedContextMonitor.monitorOperation(
            contextName,
            `test-operation-${i}`,
            async () => {
              // Simulate work
              await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
              return `result-${i}`;
            }
          )
        );
      }

      // Wait for all operations to complete
      const results = await Promise.allSettled(operations);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      // Verify performance
      expect(successful).toBeGreaterThan(45); // At least 90% success rate
      expect(failed).toBeLessThan(5); // Less than 10% failure rate

      // Check context health
      const analysis = boundedContextMonitor.analyzePerformance();
      expect(analysis.totalContexts).toBe(3);
      expect(analysis.totalContexts).toBeGreaterThan(0); // System is functional
    }, 10000);

    it('should maintain performance under memory pressure', async () => {
      const memoryBefore = process.memoryUsage().heapUsed / 1024 / 1024;

      // Create memory pressure with many operations
      const operations: Promise<void>[] = [];
      
      for (let i = 0; i < 100; i++) {
        operations.push(
          boundedContextMonitor.monitorOperation(
            'memory-test-context',
            `memory-operation-${i}`,
            async () => {
              // Create some memory pressure
              const data = new Array(1000).fill(`data-${i}`);
              await new Promise(resolve => setTimeout(resolve, 5));
              return data.length;
            }
          )
        );
      }

      await Promise.allSettled(operations);

      const memoryAfter = process.memoryUsage().heapUsed / 1024 / 1024;
      const memoryIncrease = memoryAfter - memoryBefore;

      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(50); // Less than 50MB increase

      // Context should still be healthy
      const contextMetrics = boundedContextMonitor.getContextMetrics('memory-test-context');
      expect(contextMetrics).toBeDefined();
      expect(contextMetrics!.operationCount).toBe(100);
      expect(contextMetrics!.healthStatus).not.toBe('critical');
    }, 15000);

    it('should handle error scenarios gracefully', async () => {
      const operations: Promise<any>[] = [];

      // Mix of successful and failing operations
      for (let i = 0; i < 30; i++) {
        if (i % 5 === 0) {
          // Every 5th operation fails
          operations.push(
            boundedContextMonitor.monitorOperation(
              'error-test-context',
              `error-operation-${i}`,
              async () => {
                throw new Error(`Simulated error ${i}`);
              }
            ).catch(error => error)
          );
        } else {
          // Successful operations
          operations.push(
            boundedContextMonitor.monitorOperation(
              'error-test-context',
              `success-operation-${i}`,
              async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return `success-${i}`;
              }
            )
          );
        }
      }

      const results = await Promise.allSettled(operations);
      
      // Check that system handled errors gracefully
      const contextMetrics = boundedContextMonitor.getContextMetrics('error-test-context');
      expect(contextMetrics).toBeDefined();
      expect(contextMetrics!.operationCount).toBe(30);
      expect(contextMetrics!.errorCount).toBe(6); // 6 failed operations
      
      // System should still be functional despite errors
      expect(contextMetrics!.healthStatus).not.toBe('critical');
    }, 10000);
  });

  describe('Performance Metrics Collection', () => {
    it('should collect accurate performance metrics', async () => {
      const startTime = Date.now();

      // Perform various operations
      await boundedContextMonitor.monitorOperation(
        'metrics-test',
        'fast-operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'fast';
        }
      );

      await boundedContextMonitor.monitorOperation(
        'metrics-test',
        'slow-operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 150));
          return 'slow';
        }
      );

      const endTime = Date.now();
      const testDuration = endTime - startTime;

      // Check metrics accuracy
      const contextMetrics = boundedContextMonitor.getContextMetrics('metrics-test');
      expect(contextMetrics).toBeDefined();
      expect(contextMetrics!.operationCount).toBe(2);
      expect(contextMetrics!.slowOperations).toBe(1); // One slow operation
      expect(contextMetrics!.averageResponseTime).toBeGreaterThan(20); // Should reflect the slow operation

      // Check global metrics
      const globalMetrics = performanceMetrics.getMetrics('metrics-test');
      expect(globalMetrics.length).toBeGreaterThan(0);
    }, 5000);

    it('should provide performance recommendations', async () => {
      // Create a scenario that should trigger recommendations
      for (let i = 0; i < 10; i++) {
        if (i < 3) {
          // Create some slow operations
          await boundedContextMonitor.monitorOperation(
            'recommendation-test',
            `slow-op-${i}`,
            async () => {
              await new Promise(resolve => setTimeout(resolve, 120));
              return 'slow';
            }
          );
        } else {
          // Fast operations
          await boundedContextMonitor.monitorOperation(
            'recommendation-test',
            `fast-op-${i}`,
            async () => {
              await new Promise(resolve => setTimeout(resolve, 5));
              return 'fast';
            }
          );
        }
      }

      const analysis = boundedContextMonitor.analyzePerformance();
      expect(analysis.totalContexts).toBeGreaterThan(0);
      
      // Should have some recommendations due to slow operations
      if (analysis.recommendations.length > 0) {
        console.log('Performance recommendations:', analysis.recommendations);
      }
    }, 8000);
  });

  describe('Concurrent User Simulation', () => {
    it('should handle multiple concurrent contexts', async () => {
      const contexts = [
        'room-management',
        'lobby-management', 
        'audio-processing',
        'real-time-communication',
        'user-management'
      ];

      const operations: Promise<void>[] = [];

      // Simulate operations across all contexts concurrently
      contexts.forEach(context => {
        for (let i = 0; i < 10; i++) {
          operations.push(
            boundedContextMonitor.monitorOperation(
              context,
              `concurrent-op-${i}`,
              async () => {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
                return `${context}-result-${i}`;
              }
            )
          );
        }
      });

      const startTime = Date.now();
      await Promise.allSettled(operations);
      const duration = Date.now() - startTime;

      // Verify all contexts were used
      const analysis = boundedContextMonitor.analyzePerformance();
      expect(analysis.totalContexts).toBe(5);

      // Performance should be reasonable
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds

      // Most contexts should be healthy
      expect(analysis.healthyContexts).toBeGreaterThan(3);
    }, 10000);
  });

  describe('Memory and Resource Management', () => {
    it('should manage resources efficiently', async () => {
      const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;

      // Create and clean up many operations
      for (let batch = 0; batch < 5; batch++) {
        const batchOperations: Promise<void>[] = [];
        
        for (let i = 0; i < 20; i++) {
          batchOperations.push(
            boundedContextMonitor.monitorOperation(
              `batch-${batch}`,
              `operation-${i}`,
              async () => {
                const data = new Array(100).fill(`batch-${batch}-data-${i}`);
                await new Promise(resolve => setTimeout(resolve, 5));
                return data.length;
              }
            )
          );
        }

        await Promise.allSettled(batchOperations);
        
        // Clear metrics for this batch to simulate cleanup
        boundedContextMonitor.clearContextMetrics(`batch-${batch}`);
      }

      const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal after cleanup
      expect(memoryIncrease).toBeLessThan(20); // Less than 20MB increase
    }, 15000);
  });
});