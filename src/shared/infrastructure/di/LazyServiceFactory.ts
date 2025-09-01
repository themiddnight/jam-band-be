/**
 * Lazy loading service factory for heavy services
 * Requirements: 8.3, 11.4
 */

import { performanceMetrics } from '../monitoring/PerformanceMetrics';
import { getHighResolutionTime, calculateProcessingTime } from '../../utils/timing';

export interface LazyServiceOptions {
  preloadCondition?: () => boolean;
  preloadDelay?: number;
  memoryThreshold?: number;
  timeoutMs?: number;
}

export class LazyServiceFactory<T> {
  private instance: T | null = null;
  private loading: Promise<T> | null = null;
  private loadAttempts = 0;
  private lastError: Error | null = null;
  private preloadTimer: NodeJS.Timeout | null = null;

  constructor(
    private serviceName: string,
    private factory: () => Promise<T>,
    private options: LazyServiceOptions = {}
  ) {
    this.setupPreloading();
  }

  /**
   * Get service instance (lazy loaded)
   */
  async getInstance(): Promise<T> {
    if (this.instance) {
      this.recordAccess();
      return this.instance;
    }

    if (this.loading) {
      return await this.loading;
    }

    this.loading = this.loadService();
    
    try {
      this.instance = await this.loading;
      this.recordSuccessfulLoad();
      return this.instance;
    } catch (error) {
      this.recordFailedLoad(error as Error);
      throw error;
    } finally {
      this.loading = null;
    }
  }

  /**
   * Check if service is loaded
   */
  isLoaded(): boolean {
    return this.instance !== null;
  }

  /**
   * Preload service if conditions are met
   */
  async preload(): Promise<void> {
    if (this.instance || this.loading) {
      return;
    }

    try {
      await this.getInstance();
      performanceMetrics.recordCounter(
        'service.preload.success',
        1,
        'lazy-service-factory',
        { service: this.serviceName }
      );
    } catch (error) {
      performanceMetrics.recordCounter(
        'service.preload.failure',
        1,
        'lazy-service-factory',
        { service: this.serviceName }
      );
    }
  }

  /**
   * Unload service to free memory
   */
  unload(): void {
    if (this.instance) {
      this.instance = null;
      performanceMetrics.recordCounter(
        'service.unload',
        1,
        'lazy-service-factory',
        { service: this.serviceName }
      );
    }

    if (this.preloadTimer) {
      clearTimeout(this.preloadTimer);
      this.preloadTimer = null;
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    serviceName: string;
    isLoaded: boolean;
    loadAttempts: number;
    lastError: string | null;
    memoryUsage: number;
  } {
    return {
      serviceName: this.serviceName,
      isLoaded: this.isLoaded(),
      loadAttempts: this.loadAttempts,
      lastError: this.lastError?.message || null,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  private async loadService(): Promise<T> {
    const startTime = getHighResolutionTime();
    const startMemory = process.memoryUsage().heapUsed;

    try {
      this.loadAttempts++;

      // Apply timeout if specified
      const loadPromise = this.options.timeoutMs
        ? this.withTimeout(this.factory(), this.options.timeoutMs)
        : this.factory();

      const instance = await loadPromise;
      
      const duration = calculateProcessingTime(startTime);
      const memoryDelta = (process.memoryUsage().heapUsed - startMemory) / 1024 / 1024;

      performanceMetrics.recordDuration(
        'service.lazy.load',
        duration,
        'lazy-service-factory',
        { service: this.serviceName, status: 'success' }
      );

      performanceMetrics.recordGauge(
        'service.lazy.memory',
        memoryDelta,
        'lazy-service-factory',
        { service: this.serviceName }
      );

      // Check memory threshold
      if (this.options.memoryThreshold && memoryDelta > this.options.memoryThreshold) {
        console.warn(`Service ${this.serviceName} exceeded memory threshold: ${memoryDelta.toFixed(2)}MB`);
      }

      return instance;
    } catch (error) {
      const duration = calculateProcessingTime(startTime);
      
      performanceMetrics.recordDuration(
        'service.lazy.load',
        duration,
        'lazy-service-factory',
        { service: this.serviceName, status: 'error' }
      );

      this.lastError = error as Error;
      throw error;
    }
  }

  private setupPreloading(): void {
    if (this.options.preloadCondition && this.options.preloadDelay) {
      this.preloadTimer = setTimeout(() => {
        if (this.options.preloadCondition?.()) {
          this.preload();
        }
      }, this.options.preloadDelay);
    }
  }

  private recordAccess(): void {
    performanceMetrics.recordCounter(
      'service.lazy.access',
      1,
      'lazy-service-factory',
      { service: this.serviceName }
    );
  }

  private recordSuccessfulLoad(): void {
    performanceMetrics.recordCounter(
      'service.lazy.load.success',
      1,
      'lazy-service-factory',
      { service: this.serviceName, attempts: this.loadAttempts.toString() }
    );
  }

  private recordFailedLoad(error: Error): void {
    performanceMetrics.recordCounter(
      'service.lazy.load.failure',
      1,
      'lazy-service-factory',
      { 
        service: this.serviceName, 
        attempts: this.loadAttempts.toString(),
        error: error.constructor.name
      }
    );
  }

  private estimateMemoryUsage(): number {
    // Rough estimation - in a real implementation, you might use more sophisticated memory tracking
    return this.instance ? 1 : 0; // MB
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Service ${this.serviceName} load timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timeout));
    });
  }
}

/**
 * Factory function to create lazy service factories
 */
export function createLazyService<T>(
  serviceName: string,
  factory: () => Promise<T>,
  options?: LazyServiceOptions
): LazyServiceFactory<T> {
  return new LazyServiceFactory(serviceName, factory, options);
}

/**
 * Lazy service manager for managing multiple lazy services
 */
export class LazyServiceManager {
  private services = new Map<string, LazyServiceFactory<any>>();

  /**
   * Register a lazy service
   */
  register<T>(
    name: string,
    factory: () => Promise<T>,
    options?: LazyServiceOptions
  ): void {
    const lazyService = new LazyServiceFactory(name, factory, options);
    this.services.set(name, lazyService);
  }

  /**
   * Get a lazy service
   */
  async get<T>(name: string): Promise<T> {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Lazy service not found: ${name}`);
    }
    return await service.getInstance();
  }

  /**
   * Preload all services that meet their preload conditions
   */
  async preloadAll(): Promise<void> {
    const preloadPromises = Array.from(this.services.values()).map(service => 
      service.preload().catch(error => {
        console.warn(`Failed to preload service:`, error);
      })
    );
    
    await Promise.allSettled(preloadPromises);
  }

  /**
   * Unload services to free memory
   */
  unloadUnused(): void {
    for (const [name, service] of this.services) {
      const stats = service.getStats();
      
      // Unload services that haven't been accessed recently
      // This is a simple heuristic - in practice, you'd want more sophisticated logic
      if (stats.isLoaded && stats.loadAttempts === 1) {
        service.unload();
        console.log(`Unloaded unused service: ${name}`);
      }
    }
  }

  /**
   * Get statistics for all lazy services
   */
  getStats(): Array<{
    serviceName: string;
    isLoaded: boolean;
    loadAttempts: number;
    lastError: string | null;
    memoryUsage: number;
  }> {
    return Array.from(this.services.values()).map(service => service.getStats());
  }

  /**
   * Get memory usage summary
   */
  getMemoryUsage(): {
    totalServices: number;
    loadedServices: number;
    totalMemoryUsage: number;
    averageMemoryPerService: number;
  } {
    const stats = this.getStats();
    const loadedServices = stats.filter(s => s.isLoaded);
    const totalMemoryUsage = stats.reduce((sum, s) => sum + s.memoryUsage, 0);

    return {
      totalServices: stats.length,
      loadedServices: loadedServices.length,
      totalMemoryUsage,
      averageMemoryPerService: loadedServices.length > 0 
        ? totalMemoryUsage / loadedServices.length 
        : 0
    };
  }
}

// Global lazy service manager
export const lazyServiceManager = new LazyServiceManager();