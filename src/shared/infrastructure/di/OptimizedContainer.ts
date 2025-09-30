/**
 * Optimized Dependency Injection Container
 * Requirements: 8.3, 11.4
 */

import { Container, ServiceFactory } from './Container';
import { performanceMetrics } from '../monitoring/PerformanceMetrics';
import { getHighResolutionTime, calculateProcessingTime } from '../../utils/timing';

export interface ServiceMetrics {
  initializationTime: number;
  memoryUsage: number;
  dependencyCount: number;
  isHeavy: boolean;
  lastAccessed: Date;
  accessCount: number;
}

export interface OptimizationConfig {
  heavyServiceThreshold: number; // MB
  lazyLoadingEnabled: boolean;
  circularDependencyDetection: boolean;
  serviceMetricsEnabled: boolean;
  maxConcurrentInitializations: number;
}

export class OptimizedContainer extends Container {
  private serviceMetrics = new Map<string, ServiceMetrics>();
  private initializationQueue = new Map<string, Promise<any>>();
  private config: OptimizationConfig;
  private concurrentInitializations = 0;

  constructor(config: Partial<OptimizationConfig> = {}) {
    super();
    
    this.config = {
      heavyServiceThreshold: 50, // 50MB
      lazyLoadingEnabled: true,
      circularDependencyDetection: true,
      serviceMetricsEnabled: true,
      maxConcurrentInitializations: 5,
      ...config
    };
  }

  /**
   * Enhanced service registration with optimization hints
   */
  registerOptimized<T>(
    name: string,
    factory: ServiceFactory<T>,
    options: {
      singleton?: boolean;
      lazy?: boolean;
      dependencies?: string[];
      heavy?: boolean;
      priority?: 'low' | 'normal' | 'high';
      preload?: boolean;
    } = {}
  ): void {
    const {
      singleton = true,
      lazy = options.heavy || this.config.lazyLoadingEnabled,
      dependencies = [],
      heavy = false,
      priority = 'normal',
      preload = false
    } = options;

    // Wrap factory with metrics collection
    const wrappedFactory = this.wrapFactoryWithMetrics(name, factory, heavy);

    this.register(name, wrappedFactory, {
      singleton,
      lazy: lazy && !preload,
      dependencies
    });

    // Initialize service metrics
    if (this.config.serviceMetricsEnabled) {
      this.serviceMetrics.set(name, {
        initializationTime: 0,
        memoryUsage: 0,
        dependencyCount: dependencies.length,
        isHeavy: heavy,
        lastAccessed: new Date(),
        accessCount: 0
      });
    }

    // Preload high-priority services
    if (preload && priority === 'high') {
      this.preloadService(name);
    }
  }

  /**
   * Optimized service retrieval with concurrency control
   */
  async get<T>(name: string): Promise<T> {
    // Check if service is already being initialized
    if (this.initializationQueue.has(name)) {
      return await this.initializationQueue.get(name) as T;
    }

    // Control concurrent initializations
    if (this.concurrentInitializations >= this.config.maxConcurrentInitializations) {
      await this.waitForAvailableSlot();
    }

    const initPromise = this.initializeServiceWithMetrics(name);
    this.initializationQueue.set(name, initPromise);

    try {
      const result = await initPromise;
      this.updateServiceMetrics(name);
      return result as T;
    } finally {
      this.initializationQueue.delete(name);
      this.concurrentInitializations--;
    }
  }

  /**
   * Batch initialization for related services
   */
  async getBatch<T>(serviceNames: string[]): Promise<T[]> {
    // Optimize loading order based on dependencies
    const optimizedOrder = this.optimizeLoadingOrder(serviceNames);
    
    // Initialize in batches to respect concurrency limits
    const results: T[] = [];
    const batchSize = Math.min(this.config.maxConcurrentInitializations, optimizedOrder.length);
    
    for (let i = 0; i < optimizedOrder.length; i += batchSize) {
      const batch = optimizedOrder.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(name => this.get<T>(name))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Preload services in background
   */
  async preloadServices(serviceNames: string[]): Promise<void> {
    const preloadPromises = serviceNames.map(name => this.preloadService(name));
    await Promise.allSettled(preloadPromises);
  }

  /**
   * Get service optimization recommendations
   */
  getOptimizationRecommendations(): {
    heavyServices: string[];
    circularDependencies: string[];
    underutilizedServices: string[];
    slowInitializingServices: string[];
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    const heavyServices: string[] = [];
    const underutilizedServices: string[] = [];
    const slowInitializingServices: string[] = [];

    // Analyze service metrics
    for (const [name, metrics] of this.serviceMetrics) {
      if (metrics.isHeavy || metrics.memoryUsage > this.config.heavyServiceThreshold) {
        heavyServices.push(name);
        recommendations.push(`Consider lazy loading for heavy service: ${name}`);
      }

      if (metrics.accessCount < 5 && metrics.memoryUsage > 10) {
        underutilizedServices.push(name);
        recommendations.push(`Service "${name}" is underutilized but consumes memory`);
      }

      if (metrics.initializationTime > 100) {
        slowInitializingServices.push(name);
        recommendations.push(`Service "${name}" has slow initialization (${metrics.initializationTime.toFixed(2)}ms)`);
      }
    }

    const circularDependencies = this.config.circularDependencyDetection 
      ? this.detectCircularDependencies()
      : [];

    if (circularDependencies.length > 0) {
      recommendations.push(`Found ${circularDependencies.length} circular dependencies`);
    }

    return {
      heavyServices,
      circularDependencies,
      underutilizedServices,
      slowInitializingServices,
      recommendations
    };
  }

  /**
   * Optimize service configuration based on usage patterns
   */
  optimizeConfiguration(): void {
    const metrics = Array.from(this.serviceMetrics.entries());
    
    // Convert frequently accessed services to eager loading
    metrics
      .filter(([_, m]) => m.accessCount > 10 && m.initializationTime < 50)
      .forEach(([name]) => {
        const definition = this.services.get(name);
        if (definition && definition.lazy) {
          definition.lazy = false;
          performanceMetrics.recordCounter(
            'service.optimization.eager_loading',
            1,
            'optimized-container',
            { service: name }
          );
        }
      });

    // Convert rarely accessed heavy services to lazy loading
    metrics
      .filter(([_, m]) => m.accessCount < 3 && (m.isHeavy || m.memoryUsage > 20))
      .forEach(([name]) => {
        const definition = this.services.get(name);
        if (definition && !definition.lazy) {
          definition.lazy = true;
          performanceMetrics.recordCounter(
            'service.optimization.lazy_loading',
            1,
            'optimized-container',
            { service: name }
          );
        }
      });
  }

  /**
   * Get container performance metrics
   */
  getPerformanceMetrics(): {
    totalServices: number;
    initializedServices: number;
    heavyServices: number;
    averageInitTime: number;
    totalMemoryUsage: number;
    concurrentInitializations: number;
  } {
    const metrics = Array.from(this.serviceMetrics.values());
    
    return {
      totalServices: this.services.size,
      initializedServices: this.instances.size,
      heavyServices: metrics.filter(m => m.isHeavy).length,
      averageInitTime: metrics.length > 0 
        ? metrics.reduce((sum, m) => sum + m.initializationTime, 0) / metrics.length
        : 0,
      totalMemoryUsage: metrics.reduce((sum, m) => sum + m.memoryUsage, 0),
      concurrentInitializations: this.concurrentInitializations
    };
  }

  private wrapFactoryWithMetrics<T>(
    name: string,
    factory: ServiceFactory<T>,
    isHeavy: boolean
  ): ServiceFactory<T> {
    return async () => {
      const startTime = getHighResolutionTime();
      const startMemory = process.memoryUsage().heapUsed;

      try {
        this.concurrentInitializations++;
        const result = await factory();
        
        const endTime = getHighResolutionTime();
        const endMemory = process.memoryUsage().heapUsed;
        
        const initTime = (endTime - startTime) / 1_000_000;
        const memoryDelta = Math.max(0, (endMemory - startMemory) / 1024 / 1024); // MB

        // Update metrics
        const metrics = this.serviceMetrics.get(name);
        if (metrics) {
          metrics.initializationTime = initTime;
          metrics.memoryUsage = memoryDelta;
        }

        // Record global metrics
        performanceMetrics.recordDuration(
          'service.initialization',
          initTime,
          'optimized-container',
          { service: name, heavy: isHeavy ? 'true' : 'false' }
        );

        performanceMetrics.recordGauge(
          'service.memory.usage',
          memoryDelta,
          'optimized-container',
          { service: name }
        );

        return result;
      } catch (error) {
        performanceMetrics.recordCounter(
          'service.initialization.errors',
          1,
          'optimized-container',
          { service: name }
        );
        throw error;
      }
    };
  }

  private async initializeServiceWithMetrics<T>(name: string): Promise<T> {
    const startTime = getHighResolutionTime();
    
    try {
      const result = await super.get<T>(name);
      
      const duration = calculateProcessingTime(startTime);
      performanceMetrics.recordDuration(
        'service.get',
        duration,
        'optimized-container',
        { service: name, status: 'success' }
      );
      
      return result;
    } catch (error) {
      const duration = calculateProcessingTime(startTime);
      performanceMetrics.recordDuration(
        'service.get',
        duration,
        'optimized-container',
        { service: name, status: 'error' }
      );
      throw error;
    }
  }

  private updateServiceMetrics(name: string): void {
    const metrics = this.serviceMetrics.get(name);
    if (metrics) {
      metrics.lastAccessed = new Date();
      metrics.accessCount++;
    }
  }

  private async preloadService(name: string): Promise<void> {
    try {
      await this.get(name);
      performanceMetrics.recordCounter(
        'service.preload.success',
        1,
        'optimized-container',
        { service: name }
      );
    } catch (error) {
      performanceMetrics.recordCounter(
        'service.preload.error',
        1,
        'optimized-container',
        {
          service: name,
          reason: (error as Error).message
        }
      );
    }
  }

  private optimizeLoadingOrder(serviceNames: string[]): string[] {
    const dependencyGraph = this.getDependencyGraph();
    const visited = new Set<string>();
    const result: string[] = [];

    const visit = (serviceName: string) => {
      if (visited.has(serviceName) || !serviceNames.includes(serviceName)) {
        return;
      }

      visited.add(serviceName);

      // Visit dependencies first
      const dependencies = dependencyGraph[serviceName] || [];
      dependencies.forEach(dep => visit(dep));

      result.push(serviceName);
    };

    serviceNames.forEach(name => visit(name));
    return result;
  }

  private async waitForAvailableSlot(): Promise<void> {
    return new Promise(resolve => {
      const checkSlot = () => {
        if (this.concurrentInitializations < this.config.maxConcurrentInitializations) {
          resolve();
        } else {
          setTimeout(checkSlot, 10);
        }
      };
      checkSlot();
    });
  }
}