/**
 * Decorator for automatic performance monitoring of methods
 */

import { performanceMetrics } from './PerformanceMetrics';

export interface MonitoringOptions {
  context: string;
  metricName?: string;
  tags?: Record<string, string>;
}

/**
 * Method decorator that automatically measures execution time
 */
export function Monitor(options: MonitoringOptions) {
  return function (target: any, propertyName: string, descriptor?: PropertyDescriptor): PropertyDescriptor | void {
    if (!descriptor) {
      // Handle property decorator case
      return;
    }

    const method = descriptor.value;
    const metricName = options.metricName || propertyName;

    descriptor.value = async function (...args: any[]) {
      const startTime = Bun.nanoseconds();
      
      try {
        const result = await method.apply(this, args);
        const duration = (Bun.nanoseconds() - startTime) / 1_000_000; // Convert to milliseconds
        
        performanceMetrics.recordDuration(
          metricName,
          duration,
          options.context,
          { ...options.tags, status: 'success' }
        );
        
        performanceMetrics.recordCounter(
          `${metricName}.calls`,
          1,
          options.context,
          { ...options.tags, status: 'success' }
        );
        
        return result;
      } catch (error) {
        const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
        
        performanceMetrics.recordDuration(
          metricName,
          duration,
          options.context,
          { ...options.tags, status: 'error' }
        );
        
        performanceMetrics.recordCounter(
          `${metricName}.calls`,
          1,
          options.context,
          { ...options.tags, status: 'error' }
        );
        
        performanceMetrics.recordCounter(
          `${metricName}.errors`,
          1,
          options.context,
          { ...options.tags, error: error instanceof Error ? error.constructor.name : 'UnknownError' }
        );
        
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Class decorator that automatically monitors all public methods
 */
export function MonitorClass(context: string, tags?: Record<string, string>) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const prototype = constructor.prototype;
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => name !== 'constructor' && typeof prototype[name] === 'function');

    methodNames.forEach(methodName => {
      const originalMethod = prototype[methodName];
      
      prototype[methodName] = async function (...args: any[]) {
        const startTime = Bun.nanoseconds();
        
        try {
          const result = await originalMethod.apply(this, args);
          const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
          
          performanceMetrics.recordDuration(
            methodName,
            duration,
            context,
            { ...tags, status: 'success', class: constructor.name }
          );
          
          return result;
        } catch (error) {
          const duration = (Bun.nanoseconds() - startTime) / 1_000_000;
          
          performanceMetrics.recordDuration(
            methodName,
            duration,
            context,
            { ...tags, status: 'error', class: constructor.name }
          );
          
          performanceMetrics.recordCounter(
            `${methodName}.errors`,
            1,
            context,
            { ...tags, error: error instanceof Error ? error.constructor.name : 'UnknownError', class: constructor.name }
          );
          
          throw error;
        }
      };
    });

    return constructor;
  };
}