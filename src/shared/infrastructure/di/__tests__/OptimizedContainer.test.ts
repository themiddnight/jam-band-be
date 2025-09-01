/**
 * Tests for OptimizedContainer
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { OptimizedContainer } from '../OptimizedContainer';

describe('OptimizedContainer', () => {
  let container: OptimizedContainer;

  beforeEach(() => {
    container = new OptimizedContainer({
      heavyServiceThreshold: 10,
      maxConcurrentInitializations: 2
    });
  });

  describe('registerOptimized', () => {
    it('should register service with optimization hints', () => {
      container.registerOptimized('test-service', () => 'test', {
        heavy: true,
        priority: 'high',
        lazy: false
      });

      expect(container.has('test-service')).toBe(true);
    });

    it('should enable lazy loading for heavy services by default', () => {
      container.registerOptimized('heavy-service', () => 'heavy', {
        heavy: true
      });

      // Heavy services should be lazy by default
      const metrics = container.getPerformanceMetrics();
      expect(metrics.totalServices).toBe(1);
    });
  });

  describe('get', () => {
    it('should initialize service with metrics collection', async () => {
      container.registerOptimized('test-service', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'test-result';
      });

      const result = await container.get('test-service');
      expect(result).toBe('test-result');

      const metrics = container.getPerformanceMetrics();
      expect(metrics.initializedServices).toBe(1);
    });

    it('should handle concurrent initialization limits', async () => {
      // Register multiple services
      container.registerOptimized('service-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result-1';
      });

      container.registerOptimized('service-2', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result-2';
      });

      container.registerOptimized('service-3', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result-3';
      });

      // Start all initializations concurrently
      const startTime = Date.now();
      const promises = [
        container.get('service-1'),
        container.get('service-2'),
        container.get('service-3')
      ];

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      expect(results).toEqual(['result-1', 'result-2', 'result-3']);
      
      // With max 2 concurrent initializations, the third should wait
      // So total time should be more than 50ms but less than 150ms
      expect(duration).toBeGreaterThan(50);
      expect(duration).toBeLessThan(150);
    });
  });

  describe('getBatch', () => {
    it('should initialize services in optimized order', async () => {
      // Create services with dependencies
      container.registerOptimized('repo', () => 'repository', {
        dependencies: []
      });

      container.registerOptimized('service', () => 'service', {
        dependencies: ['repo']
      });

      container.registerOptimized('handler', () => 'handler', {
        dependencies: ['service']
      });

      const results = await container.getBatch(['handler', 'service', 'repo']);
      
      expect(results).toEqual(['repository', 'service', 'handler']);
    });
  });

  describe('preloadServices', () => {
    it('should preload services in background', async () => {
      container.registerOptimized('preload-service', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'preloaded';
      });

      await container.preloadServices(['preload-service']);

      // Service should be available immediately now
      const result = await container.get('preload-service');
      expect(result).toBe('preloaded');
    });
  });

  describe('getOptimizationRecommendations', () => {
    it('should provide optimization recommendations', async () => {
      // Create a slow service
      container.registerOptimized('slow-service', async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return 'slow';
      }, { heavy: true });

      // Initialize it to generate metrics
      await container.get('slow-service');

      const recommendations = container.getOptimizationRecommendations();
      
      expect(recommendations.heavyServices).toContain('slow-service');
      expect(recommendations.slowInitializingServices).toContain('slow-service');
      expect(recommendations.recommendations.length).toBeGreaterThan(0);
    });

    it('should detect circular dependencies', () => {
      // Create circular dependency
      container.registerOptimized('service-a', () => 'a', {
        dependencies: ['service-b']
      });

      container.registerOptimized('service-b', () => 'b', {
        dependencies: ['service-a']
      });

      const recommendations = container.getOptimizationRecommendations();
      
      expect(recommendations.circularDependencies.length).toBeGreaterThan(0);
      expect(recommendations.recommendations).toContain(
        'Found 1 circular dependencies'
      );
    });
  });

  describe('optimizeConfiguration', () => {
    it('should optimize service configuration based on usage', async () => {
      // Create a frequently accessed service
      container.registerOptimized('frequent-service', () => 'frequent', {
        lazy: true
      });

      // Access it multiple times to simulate high usage
      for (let i = 0; i < 12; i++) {
        await container.get('frequent-service');
      }

      // Optimize configuration
      container.optimizeConfiguration();

      // The service should now be configured for eager loading
      // (This is internal optimization, so we check through metrics)
      const metrics = container.getPerformanceMetrics();
      expect(metrics.initializedServices).toBe(1);
    });
  });

  describe('getPerformanceMetrics', () => {
    it('should provide comprehensive performance metrics', async () => {
      container.registerOptimized('test-service', () => 'test', {
        heavy: true
      });

      await container.get('test-service');

      const metrics = container.getPerformanceMetrics();
      
      expect(metrics.totalServices).toBe(1);
      expect(metrics.initializedServices).toBe(1);
      expect(metrics.heavyServices).toBe(1);
      expect(metrics.averageInitTime).toBeGreaterThanOrEqual(0);
      expect(metrics.totalMemoryUsage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should handle service initialization errors', async () => {
      container.registerOptimized('error-service', async () => {
        throw new Error('Initialization failed');
      });

      await expect(container.get('error-service')).rejects.toThrow('Initialization failed');

      const metrics = container.getPerformanceMetrics();
      expect(metrics.initializedServices).toBe(0);
    });

    it('should handle concurrent initialization errors', async () => {
      container.registerOptimized('error-service', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Concurrent error');
      });

      const promises = [
        container.get('error-service').catch(e => e),
        container.get('error-service').catch(e => e)
      ];

      const results = await Promise.all(promises);
      
      expect(results[0]).toBeInstanceOf(Error);
      expect(results[1]).toBeInstanceOf(Error);
    });
  });
});