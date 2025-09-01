/**
 * Tests for dependency injection container
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Container, CircularDependencyError, ServiceNotFoundError } from '../Container';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('service registration', () => {
    it('should register and resolve singleton service', async () => {
      let instanceCount = 0;
      
      container.singleton('testService', () => {
        instanceCount++;
        return { id: instanceCount };
      });

      const instance1 = await container.get('testService');
      const instance2 = await container.get('testService');

      expect(instance1).toBe(instance2);
      expect(instanceCount).toBe(1);
    });

    it('should register and resolve transient service', async () => {
      let instanceCount = 0;
      
      container.transient('testService', () => {
        instanceCount++;
        return { id: instanceCount };
      });

      const instance1 = await container.get('testService');
      const instance2 = await container.get('testService');

      expect(instance1).not.toBe(instance2);
      expect(instanceCount).toBe(2);
    });

    it('should register and resolve lazy service', async () => {
      let instanceCount = 0;
      
      container.lazy('testService', () => {
        instanceCount++;
        return { id: instanceCount };
      });

      // Service should not be created until first access
      expect(instanceCount).toBe(0);

      const instance = await container.get('testService');
      expect(instanceCount).toBe(1);
      expect(instance.id).toBe(1);
    });
  });

  describe('dependency resolution', () => {
    it('should resolve service with dependencies', async () => {
      container.singleton('dependency', () => ({ name: 'dep' }));
      
      container.singleton('service', async () => {
        const dep = await container.get('dependency');
        return { dependency: dep };
      }, ['dependency']);

      const service = await container.get('service');
      expect(service.dependency.name).toBe('dep');
    });

    it('should resolve complex dependency chain', async () => {
      container.singleton('a', () => ({ name: 'a' }));
      container.singleton('b', async () => {
        const a = await container.get('a');
        return { name: 'b', a };
      }, ['a']);
      container.singleton('c', async () => {
        const b = await container.get('b');
        return { name: 'c', b };
      }, ['b']);

      const service = await container.get('c');
      expect(service.name).toBe('c');
      expect(service.b.name).toBe('b');
      expect(service.b.a.name).toBe('a');
    });
  });

  describe('circular dependency detection', () => {
    it('should detect direct circular dependency', async () => {
      container.singleton('a', async () => {
        const b = await container.get('b');
        return { name: 'a', b };
      }, ['b']);
      
      container.singleton('b', async () => {
        const a = await container.get('a');
        return { name: 'b', a };
      }, ['a']);

      await expect(container.get('a')).rejects.toThrow(CircularDependencyError);
    });

    it('should detect indirect circular dependency', async () => {
      container.singleton('a', async () => {
        const b = await container.get('b');
        return { name: 'a', b };
      }, ['b']);
      
      container.singleton('b', async () => {
        const c = await container.get('c');
        return { name: 'b', c };
      }, ['c']);
      
      container.singleton('c', async () => {
        const a = await container.get('a');
        return { name: 'c', a };
      }, ['a']);

      await expect(container.get('a')).rejects.toThrow(CircularDependencyError);
    });

    it('should detect circular dependencies in dependency graph', () => {
      container.register('a', () => ({}), { dependencies: ['b'] });
      container.register('b', () => ({}), { dependencies: ['c'] });
      container.register('c', () => ({}), { dependencies: ['a'] });

      const cycles = container.detectCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('a');
      expect(cycles[0]).toContain('b');
      expect(cycles[0]).toContain('c');
    });
  });

  describe('error handling', () => {
    it('should throw error for non-existent service', async () => {
      await expect(container.get('nonExistent')).rejects.toThrow(ServiceNotFoundError);
    });

    it('should handle async factory errors', async () => {
      container.singleton('failingService', async () => {
        throw new Error('Factory failed');
      });

      await expect(container.get('failingService')).rejects.toThrow('Factory failed');
    });
  });

  describe('synchronous operations', () => {
    it('should get service synchronously', () => {
      container.singleton('syncService', () => ({ name: 'sync' }));

      const service = container.getSync('syncService');
      expect(service.name).toBe('sync');
    });

    it('should throw error for async service in sync get', () => {
      container.singleton('asyncService', async () => ({ name: 'async' }));

      expect(() => container.getSync('asyncService')).toThrow();
    });
  });

  describe('utility methods', () => {
    it('should check if service exists', () => {
      container.singleton('existingService', () => ({}));

      expect(container.has('existingService')).toBe(true);
      expect(container.has('nonExistentService')).toBe(false);
    });

    it('should clear instances', async () => {
      let instanceCount = 0;
      
      container.singleton('testService', () => {
        instanceCount++;
        return { id: instanceCount };
      });

      await container.get('testService');
      expect(instanceCount).toBe(1);

      container.clearInstances();
      await container.get('testService');
      expect(instanceCount).toBe(2); // New instance created
    });

    it('should get dependency graph', () => {
      container.register('a', () => ({}), { dependencies: ['b', 'c'] });
      container.register('b', () => ({}), { dependencies: ['c'] });
      container.register('c', () => ({}));

      const graph = container.getDependencyGraph();
      expect(graph.a).toEqual(['b', 'c']);
      expect(graph.b).toEqual(['c']);
      expect(graph.c).toEqual([]);
    });
  });
});