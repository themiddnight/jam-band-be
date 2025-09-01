/**
 * Service registry for bounded context services
 */

import { Container } from './Container';
import { performanceMetrics } from '../monitoring/PerformanceMetrics';

export interface BoundedContextServices {
  applicationServices: string[];
  domainServices: string[];
  repositories: string[];
  handlers: string[];
}

export class ServiceRegistry {
  private contextServices = new Map<string, BoundedContextServices>();

  constructor(private container: Container) {}

  /**
   * Register services for a bounded context
   */
  registerContext(
    contextName: string,
    services: BoundedContextServices
  ): void {
    this.contextServices.set(contextName, services);
    
    // Record context registration
    performanceMetrics.recordCounter(
      'context.registered',
      1,
      'service-registry',
      { context: contextName }
    );
  }

  /**
   * Get all services for a context
   */
  getContextServices(contextName: string): BoundedContextServices | undefined {
    return this.contextServices.get(contextName);
  }

  /**
   * Initialize all services for a context (lazy loading)
   */
  async initializeContext(contextName: string): Promise<void> {
    const startTime = Bun.nanoseconds();
    
    try {
      const services = this.contextServices.get(contextName);
      if (!services) {
        throw new Error(`Context not found: ${contextName}`);
      }

      // Initialize in order: repositories -> domain services -> application services -> handlers
      const initOrder = [
        ...services.repositories,
        ...services.domainServices,
        ...services.applicationServices,
        ...services.handlers
      ];

      for (const serviceName of initOrder) {
        if (this.container.has(serviceName)) {
          await this.container.get(serviceName);
        }
      }

      const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
      
      performanceMetrics.recordDuration(
        'context.initialization',
        duration,
        'service-registry',
        { context: contextName, status: 'success' }
      );
      
    } catch (error) {
      const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
      
      performanceMetrics.recordDuration(
        'context.initialization',
        duration,
        'service-registry',
        { context: contextName, status: 'error' }
      );
      
      throw error;
    }
  }

  /**
   * Get dependency analysis for all contexts
   */
  analyzeDependencies(): {
    contexts: string[];
    totalServices: number;
    circularDependencies: string[];
    heavyContexts: Array<{
      context: string;
      serviceCount: number;
    }>;
  } {
    const contexts = Array.from(this.contextServices.keys());
    const totalServices = Array.from(this.contextServices.values())
      .reduce((total, services) => {
        return total + 
          services.applicationServices.length +
          services.domainServices.length +
          services.repositories.length +
          services.handlers.length;
      }, 0);

    const circularDependencies = this.container.detectCircularDependencies();
    
    const heavyContexts = Array.from(this.contextServices.entries())
      .map(([context, services]) => ({
        context,
        serviceCount: services.applicationServices.length +
                     services.domainServices.length +
                     services.repositories.length +
                     services.handlers.length
      }))
      .filter(ctx => ctx.serviceCount > 10)
      .sort((a, b) => b.serviceCount - a.serviceCount);

    return {
      contexts,
      totalServices,
      circularDependencies,
      heavyContexts
    };
  }

  /**
   * Optimize service loading order
   */
  optimizeLoadingOrder(contextName: string): string[] {
    const services = this.contextServices.get(contextName);
    if (!services) {
      return [];
    }

    // Optimal loading order based on dependency hierarchy
    const optimizedOrder: string[] = [];
    
    // 1. Repositories first (no dependencies typically)
    optimizedOrder.push(...services.repositories);
    
    // 2. Domain services (depend on repositories)
    optimizedOrder.push(...services.domainServices);
    
    // 3. Application services (depend on domain services and repositories)
    optimizedOrder.push(...services.applicationServices);
    
    // 4. Handlers last (depend on application services)
    optimizedOrder.push(...services.handlers);

    return optimizedOrder;
  }

  /**
   * Get service health metrics
   */
  getServiceHealth(): {
    totalContexts: number;
    initializedServices: number;
    failedInitializations: number;
    averageInitTime: number;
  } {
    const contextMetrics = performanceMetrics.getMetrics('service-registry');
    
    const initMetrics = contextMetrics.filter(m => 
      m.name === 'context.initialization.duration'
    );
    
    const successfulInits = initMetrics.filter(m => 
      m.tags?.status === 'success'
    ).length;
    
    const failedInits = initMetrics.filter(m => 
      m.tags?.status === 'error'
    ).length;
    
    const averageInitTime = initMetrics.length > 0
      ? initMetrics.reduce((sum, m) => sum + m.value, 0) / initMetrics.length
      : 0;

    return {
      totalContexts: this.contextServices.size,
      initializedServices: successfulInits,
      failedInitializations: failedInits,
      averageInitTime
    };
  }
}

// Global service registry
import { container } from './Container';
export const serviceRegistry = new ServiceRegistry(container);