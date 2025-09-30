/**
 * Decorator for automatic performance monitoring of methods
 */

import { boundedContextMonitor } from './BoundedContextMonitor';

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
      return await boundedContextMonitor.monitorOperation(
        options.context,
        metricName,
        async () => {
          return await method.apply(this, args);
        }
      );
    };

    return descriptor;
  };
}

/**
 * Class decorator that automatically monitors all public methods
 */
export function MonitorClass(context: string, _tags?: Record<string, string>) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const prototype = constructor.prototype;
    const methodNames = Object.getOwnPropertyNames(prototype)
      .filter(name => name !== 'constructor' && typeof prototype[name] === 'function');

    methodNames.forEach(methodName => {
      const originalMethod = prototype[methodName];
      
      prototype[methodName] = async function (...args: any[]) {
        return await boundedContextMonitor.monitorOperation(
          context,
          `${constructor.name}.${methodName}`,
          async () => {
            return await originalMethod.apply(this, args);
          }
        );
      };
    });

    return constructor;
  };
}