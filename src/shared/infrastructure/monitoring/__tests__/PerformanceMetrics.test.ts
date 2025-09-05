/**
 * Tests for performance metrics collection
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { InMemoryPerformanceMetrics } from '../PerformanceMetrics';

describe('PerformanceMetrics', () => {
  let metrics: InMemoryPerformanceMetrics;

  beforeEach(() => {
    metrics = new InMemoryPerformanceMetrics();
  });

  describe('recordDuration', () => {
    it('should record duration metrics', () => {
      metrics.recordDuration('testOperation', 150, 'test-context', { operation: 'test' });

      const recorded = metrics.getMetrics('test-context');
      expect(recorded).toHaveLength(1);
      expect(recorded[0].name).toBe('testOperation.duration');
      expect(recorded[0].value).toBe(150);
      expect(recorded[0].context).toBe('test-context');
      expect(recorded[0].tags?.type).toBe('duration');
      expect(recorded[0].tags?.operation).toBe('test');
    });
  });

  describe('recordCounter', () => {
    it('should record counter metrics', () => {
      metrics.recordCounter('requests', 5, 'api-context');

      const recorded = metrics.getMetrics('api-context');
      expect(recorded).toHaveLength(1);
      expect(recorded[0].name).toBe('requests.count');
      expect(recorded[0].value).toBe(5);
      expect(recorded[0].tags?.type).toBe('counter');
    });
  });

  describe('recordGauge', () => {
    it('should record gauge metrics', () => {
      metrics.recordGauge('memoryUsage', 75.5, 'system-context');

      const recorded = metrics.getMetrics('system-context');
      expect(recorded).toHaveLength(1);
      expect(recorded[0].name).toBe('memoryUsage.gauge');
      expect(recorded[0].value).toBe(75.5);
      expect(recorded[0].tags?.type).toBe('gauge');
    });
  });

  describe('getMetrics', () => {
    it('should return all metrics when no context specified', () => {
      metrics.recordDuration('op1', 100, 'context1');
      metrics.recordDuration('op2', 200, 'context2');

      const allMetrics = metrics.getMetrics();
      expect(allMetrics).toHaveLength(2);
    });

    it('should filter metrics by context', () => {
      metrics.recordDuration('op1', 100, 'context1');
      metrics.recordDuration('op2', 200, 'context2');

      const context1Metrics = metrics.getMetrics('context1');
      expect(context1Metrics).toHaveLength(1);
      expect(context1Metrics[0].context).toBe('context1');
    });
  });

  describe('clearMetrics', () => {
    it('should clear all metrics when no context specified', () => {
      metrics.recordDuration('op1', 100, 'context1');
      metrics.recordDuration('op2', 200, 'context2');

      metrics.clearMetrics();
      expect(metrics.getMetrics()).toHaveLength(0);
    });

    it('should clear metrics for specific context', () => {
      metrics.recordDuration('op1', 100, 'context1');
      metrics.recordDuration('op2', 200, 'context2');

      metrics.clearMetrics('context1');
      const remaining = metrics.getMetrics();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].context).toBe('context2');
    });
  });

  describe('memory management', () => {
    it('should prevent memory leaks by limiting stored metrics', () => {
      // Record more than maxMetrics (10000)
      for (let i = 0; i < 10005; i++) {
        metrics.recordDuration(`op${i}`, 100, 'test-context');
      }

      const allMetrics = metrics.getMetrics();
      expect(allMetrics.length).toBeLessThanOrEqual(10000);
    });
  });
});