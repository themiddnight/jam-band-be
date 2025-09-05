/**
 * Tests for BoundedContextMonitor
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { BoundedContextMonitor } from '../BoundedContextMonitor';
import { InMemoryPerformanceMetrics } from '../PerformanceMetrics';

describe('BoundedContextMonitor', () => {
  let monitor: BoundedContextMonitor;
  let mockMetrics: InMemoryPerformanceMetrics;

  beforeEach(() => {
    mockMetrics = new InMemoryPerformanceMetrics();
    monitor = new BoundedContextMonitor(mockMetrics);
  });

  describe('monitorOperation', () => {
    it('should record successful operation metrics', async () => {
      const result = await monitor.monitorOperation(
        'test-context',
        'test-operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'success';
        }
      );

      expect(result).toBe('success');

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics).toBeDefined();
      expect(contextMetrics!.operationCount).toBe(1);
      expect(contextMetrics!.errorCount).toBe(0);
      expect(contextMetrics!.healthStatus).toBe('healthy');
    });

    it('should record failed operation metrics', async () => {
      const error = new Error('Test error');

      await expect(
        monitor.monitorOperation(
          'test-context',
          'test-operation',
          async () => {
            throw error;
          }
        )
      ).rejects.toThrow('Test error');

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics).toBeDefined();
      expect(contextMetrics!.operationCount).toBe(1);
      expect(contextMetrics!.errorCount).toBe(1);
    });

    it('should track slow operations', async () => {
      // Add a fast operation first to dilute the slow operation rate
      await monitor.monitorOperation(
        'test-context',
        'fast-operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'fast';
        }
      );

      await monitor.monitorOperation(
        'test-context',
        'slow-operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 150)); // Exceeds 100ms threshold
          return 'slow';
        }
      );

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics!.slowOperations).toBe(1);
      expect(contextMetrics!.operationCount).toBe(2);
      expect(contextMetrics!.healthStatus).toBe('warning');
    });

    it('should update average response time', async () => {
      // First operation - 50ms
      await monitor.monitorOperation(
        'test-context',
        'operation-1',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'result1';
        }
      );

      // Second operation - 100ms
      await monitor.monitorOperation(
        'test-context',
        'operation-2',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'result2';
        }
      );

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics!.averageResponseTime).toBeGreaterThan(0);
      expect(contextMetrics!.operationCount).toBe(2);
    });
  });

  describe('recordMemoryUsage', () => {
    it('should record memory usage for context', () => {
      monitor.recordMemoryUsage('test-context', 256);

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics!.memoryUsage).toBe(256);
    });
  });

  describe('analyzePerformance', () => {
    it('should analyze performance across contexts', async () => {
      // Create healthy context
      await monitor.monitorOperation('healthy-context', 'fast-op', async () => 'ok');

      // Create warning context with slow operations
      await monitor.monitorOperation('warning-context', 'fast-op', async () => 'fast');
      await monitor.monitorOperation('warning-context', 'slow-op', async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return 'slow';
      });
      await monitor.monitorOperation('warning-context', 'fast-op2', async () => 'fast');

      // Create critical context with high error rate
      for (let i = 0; i < 10; i++) {
        if (i < 3) { // 30% error rate (critical)
          try {
            await monitor.monitorOperation('critical-context', 'error-op', async () => {
              throw new Error('Critical error');
            });
          } catch (e) {
            // Expected
          }
        } else {
          await monitor.monitorOperation('critical-context', 'success-op', async () => 'ok');
        }
      }

      const analysis = monitor.analyzePerformance();

      expect(analysis.totalContexts).toBe(3);
      expect(analysis.healthyContexts).toBe(1);
      expect(analysis.warningContexts).toBe(1);
      expect(analysis.criticalContexts).toBe(1);
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('getPerformanceSummary', () => {
    it('should provide comprehensive performance summary', async () => {
      await monitor.monitorOperation('test-context', 'test-op', async () => 'ok');

      const summary = monitor.getPerformanceSummary();

      expect(summary.contexts.length).toBe(1);
      expect(summary.systemHealth).toBe('healthy');
      expect(summary.alerts).toBeDefined();
      expect(summary.recentOperations).toBeDefined();
    });
  });

  describe('health status calculation', () => {
    it('should mark context as critical with high error rate', async () => {
      // Generate operations with >20% error rate (critical threshold)
      for (let i = 0; i < 10; i++) {
        if (i < 3) { // 30% error rate
          try {
            await monitor.monitorOperation('test-context', 'error-op', async () => {
              throw new Error('Test error');
            });
          } catch (e) {
            // Expected
          }
        } else {
          await monitor.monitorOperation('test-context', 'success-op', async () => 'ok');
        }
      }

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics!.healthStatus).toBe('critical');
    });

    it('should mark context as warning with moderate issues', async () => {
      // Generate operations with moderate slow operations (between 20% and 50%)
      for (let i = 0; i < 10; i++) {
        if (i < 3) { // 30% slow operations (warning level)
          await monitor.monitorOperation('test-context', 'slow-op', async () => {
            await new Promise(resolve => setTimeout(resolve, 120));
            return 'slow';
          });
        } else {
          await monitor.monitorOperation('test-context', 'fast-op', async () => 'fast');
        }
      }

      const contextMetrics = monitor.getContextMetrics('test-context');
      expect(contextMetrics!.healthStatus).toBe('warning');
    });
  });

  describe('clearContextMetrics', () => {
    it('should clear metrics for specific context', async () => {
      await monitor.monitorOperation('context-1', 'op1', async () => 'ok');
      await monitor.monitorOperation('context-2', 'op2', async () => 'ok');

      expect(monitor.getContextMetrics('context-1')).toBeDefined();
      expect(monitor.getContextMetrics('context-2')).toBeDefined();

      monitor.clearContextMetrics('context-1');

      expect(monitor.getContextMetrics('context-1')).toBeUndefined();
      expect(monitor.getContextMetrics('context-2')).toBeDefined();
    });

    it('should clear all metrics when no context specified', async () => {
      await monitor.monitorOperation('context-1', 'op1', async () => 'ok');
      await monitor.monitorOperation('context-2', 'op2', async () => 'ok');

      monitor.clearContextMetrics();

      expect(monitor.getAllContextMetrics().size).toBe(0);
      expect(monitor.getOperationHistory().length).toBe(0);
    });
  });
});