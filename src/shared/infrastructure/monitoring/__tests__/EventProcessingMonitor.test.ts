/**
 * Tests for event processing monitoring
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { EventProcessingMonitor } from '../EventProcessingMonitor';

describe('EventProcessingMonitor', () => {
  let monitor: EventProcessingMonitor;

  beforeEach(() => {
    monitor = new EventProcessingMonitor();
  });

  describe('monitorEventProcessing', () => {
    it('should monitor successful event processing', async () => {
      const result = await monitor.monitorEventProcessing(
        'TestEvent',
        2,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'success';
        }
      );

      expect(result).toBe('success');

      const stats = monitor.getEventStats('TestEvent');
      expect(stats.totalEvents).toBe(1);
      expect(stats.successRate).toBe(1);
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
    });

    it('should monitor failed event processing', async () => {
      try {
        await monitor.monitorEventProcessing(
          'FailingEvent',
          1,
          async () => {
            throw new Error('Processing failed');
          }
        );
      } catch (error) {
        expect(error.message).toBe('Processing failed');
      }

      const stats = monitor.getEventStats('FailingEvent');
      expect(stats.totalEvents).toBe(1);
      expect(stats.successRate).toBe(0);
    });
  });

  describe('getEventStats', () => {
    it('should return correct statistics for specific event type', async () => {
      // Process some successful events
      for (let i = 0; i < 3; i++) {
        await monitor.monitorEventProcessing(
          'TestEvent',
          1,
          async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            return 'success';
          }
        );
      }

      // Process one failing event
      try {
        await monitor.monitorEventProcessing(
          'TestEvent',
          1,
          async () => {
            throw new Error('Failed');
          }
        );
      } catch {}

      const stats = monitor.getEventStats('TestEvent');
      expect(stats.totalEvents).toBe(4);
      expect(stats.successRate).toBe(0.75); // 3 out of 4 successful
      expect(stats.averageProcessingTime).toBeGreaterThan(0);
    });

    it('should return empty stats for non-existent event type', () => {
      const stats = monitor.getEventStats('NonExistentEvent');
      expect(stats.totalEvents).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageProcessingTime).toBe(0);
    });
  });

  describe('detectBottlenecks', () => {
    it('should detect slow events', async () => {
      // Create a slow event
      await monitor.monitorEventProcessing(
        'SlowEvent',
        1,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 150)); // 150ms > 100ms threshold
          return 'success';
        }
      );

      const bottlenecks = monitor.detectBottlenecks();
      expect(bottlenecks.slowEvents.length).toBeGreaterThan(0);
      expect(bottlenecks.slowEvents[0].eventType).toBe('SlowEvent');
    });

    it('should detect high error rate events', async () => {
      // Create events with high error rate
      for (let i = 0; i < 5; i++) {
        try {
          await monitor.monitorEventProcessing(
            'ErrorProneEvent',
            1,
            async () => {
              throw new Error('Failed');
            }
          );
        } catch {}
      }

      const bottlenecks = monitor.detectBottlenecks();
      expect(bottlenecks.highErrorRateEvents).toContain('ErrorProneEvent');
    });

    it('should provide recommendations for performance issues', async () => {
      // Create slow event
      await monitor.monitorEventProcessing(
        'SlowEvent',
        1,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 150));
          return 'success';
        }
      );

      // Create event with many handlers
      await monitor.monitorEventProcessing(
        'ComplexEvent',
        10, // Many handlers
        async () => 'success'
      );

      const bottlenecks = monitor.detectBottlenecks();
      expect(bottlenecks.recommendations.length).toBeGreaterThan(0);
    });
  });
});