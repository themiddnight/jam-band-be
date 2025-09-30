/**
 * Dependency Injection Container with lazy loading support
 */

export type ServiceFactory<T = any> = () => T | Promise<T>;
export type ServiceInstance<T = any> = T;

export interface ServiceDefinition<T = any> {
  factory: ServiceFactory<T>;
  singleton: boolean;
  lazy: boolean;
  dependencies?: string[];
}

export class Container {
  protected services = new Map<string, ServiceDefinition>();
  protected instances = new Map<string, ServiceInstance>();
  private loading = new Set<string>();

  /**
   * Register a service with the container
   */
  register<T>(
    name: string,
    factory: ServiceFactory<T>,
    options: {
      singleton?: boolean;
      lazy?: boolean;
      dependencies?: string[];
    } = {}
  ): void {
    const {
      singleton = true,
      lazy = false,
      dependencies = []
    } = options;

    this.services.set(name, {
      factory,
      singleton,
      lazy,
      dependencies
    });
  }

  /**
   * Register a singleton service (default behavior)
   */
  singleton<T>(name: string, factory: ServiceFactory<T>, dependencies?: string[]): void {
    this.register(name, factory, { singleton: true, ...(dependencies && { dependencies }) });
  }

  /**
   * Register a transient service (new instance each time)
   */
  transient<T>(name: string, factory: ServiceFactory<T>, dependencies?: string[]): void {
    this.register(name, factory, { singleton: false, ...(dependencies && { dependencies }) });
  }

  /**
   * Register a lazy-loaded singleton service
   */
  lazy<T>(name: string, factory: ServiceFactory<T>, dependencies?: string[]): void {
    this.register(name, factory, { singleton: true, lazy: true, ...(dependencies && { dependencies }) });
  }

  /**
   * Get a service instance
   */
  async get<T>(name: string): Promise<T> {
    // Check for circular dependency
    if (this.loading.has(name)) {
      throw new CircularDependencyError(`Circular dependency detected for service: ${name}`);
    }

    const definition = this.services.get(name);
    if (!definition) {
      throw new ServiceNotFoundError(`Service not found: ${name}`);
    }

    // Return existing singleton instance if available
    if (definition.singleton && this.instances.has(name)) {
      return this.instances.get(name) as T;
    }

    // Mark as loading to detect circular dependencies
    this.loading.add(name);

    try {
      // Resolve dependencies first
  await this.resolveDependencies(definition.dependencies || []);
      
      // Create instance
      const instance = await definition.factory();

      // Store singleton instance
      if (definition.singleton) {
        this.instances.set(name, instance);
      }

      return instance as T;
    } finally {
      this.loading.delete(name);
    }
  }

  /**
   * Get a service synchronously (only works for non-async factories)
   */
  getSync<T>(name: string): T {
    const definition = this.services.get(name);
    if (!definition) {
      throw new ServiceNotFoundError(`Service not found: ${name}`);
    }

    // Return existing singleton instance if available
    if (definition.singleton && this.instances.has(name)) {
      return this.instances.get(name) as T;
    }

    // Check for circular dependency
    if (this.loading.has(name)) {
      throw new CircularDependencyError(`Circular dependency detected for service: ${name}`);
    }

    this.loading.add(name);

    try {
      const instance = definition.factory();
      
      // Ensure it's not a Promise
      if (instance instanceof Promise) {
        throw new Error(`Cannot get async service synchronously: ${name}`);
      }

      // Store singleton instance
      if (definition.singleton) {
        this.instances.set(name, instance);
      }

      return instance as T;
    } finally {
      this.loading.delete(name);
    }
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Clear all instances (useful for testing)
   */
  clearInstances(): void {
    this.instances.clear();
  }

  /**
   * Get dependency graph for analysis
   */
  getDependencyGraph(): Record<string, string[]> {
    const graph: Record<string, string[]> = {};
    
    for (const [name, definition] of this.services) {
      graph[name] = definition.dependencies || [];
    }
    
    return graph;
  }

  /**
   * Detect circular dependencies
   */
  detectCircularDependencies(): string[] {
    const graph = this.getDependencyGraph();
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[] = [];

    const dfs = (node: string, path: string[]): void => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).concat(node);
        cycles.push(cycle.join(' -> '));
        return;
      }

      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      recursionStack.add(node);

      const dependencies = graph[node] || [];
      for (const dep of dependencies) {
        dfs(dep, [...path, node]);
      }

      recursionStack.delete(node);
    };

    for (const service of Object.keys(graph)) {
      if (!visited.has(service)) {
        dfs(service, []);
      }
    }

    return cycles;
  }

  /**
   * Resolve service dependencies
   */
  private async resolveDependencies(dependencies: string[]): Promise<any[]> {
    return Promise.all(dependencies.map(dep => this.get(dep)));
  }
}

/**
 * Service container errors
 */
export class ServiceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceNotFoundError';
  }
}

export class CircularDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

// Global container instance
export const container = new Container();