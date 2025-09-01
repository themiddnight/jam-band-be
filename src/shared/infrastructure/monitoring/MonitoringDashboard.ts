/**
 * Monitoring dashboard for performance metrics visualization
 */

import { performanceMetrics, MetricData } from './PerformanceMetrics';
import { eventProcessingMonitor } from './EventProcessingMonitor';

export interface DashboardMetrics {
  contexts: ContextMetrics[];
  eventProcessing: EventProcessingStats;
  systemHealth: SystemHealthMetrics;
  recommendations: string[];
}

export interface ContextMetrics {
  context: string;
  totalOperations: number;
  averageResponseTime: number;
  errorRate: number;
  slowestOperation: {
    name: string;
    duration: number;
  };
  fastestOperation: {
    name: string;
    duration: number;
  };
  operationBreakdown: Array<{
    operation: string;
    count: number;
    averageDuration: number;
    errorCount: number;
  }>;
}

export interface EventProcessingStats {
  totalEvents: number;
  averageProcessingTime: number;
  successRate: number;
  slowestEvent: number;
  fastestEvent: number;
  eventTypeBreakdown: Array<{
    eventType: string;
    count: number;
    averageTime: number;
    errorRate: number;
  }>;
}

export interface SystemHealthMetrics {
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  uptime: number;
  activeConnections: number;
  requestsPerSecond: number;
}

export class MonitoringDashboard {
  /**
   * Get comprehensive dashboard metrics
   */
  getDashboardMetrics(): DashboardMetrics {
    const allMetrics = performanceMetrics.getMetrics();
    const contexts = this.getContextMetrics(allMetrics);
    const eventProcessing = this.getEventProcessingStats();
    const systemHealth = this.getSystemHealthMetrics();
    const recommendations = this.generateRecommendations(contexts, eventProcessing);

    return {
      contexts,
      eventProcessing,
      systemHealth,
      recommendations
    };
  }

  /**
   * Get metrics for each bounded context
   */
  private getContextMetrics(allMetrics: MetricData[]): ContextMetrics[] {
    const contextGroups = this.groupMetricsByContext(allMetrics);
    
    return Object.entries(contextGroups).map(([context, metrics]) => {
      const durationMetrics = metrics.filter(m => m.name.endsWith('.duration'));
      const errorMetrics = metrics.filter(m => m.name.endsWith('.errors'));
      const callMetrics = metrics.filter(m => m.name.endsWith('.calls'));

      const totalOperations = callMetrics.reduce((sum, m) => sum + m.value, 0);
      const totalDuration = durationMetrics.reduce((sum, m) => sum + m.value, 0);
      const totalErrors = errorMetrics.reduce((sum, m) => sum + m.value, 0);

      const averageResponseTime = durationMetrics.length > 0 
        ? totalDuration / durationMetrics.length 
        : 0;

      const errorRate = totalOperations > 0 ? totalErrors / totalOperations : 0;

      const durations = durationMetrics.map(m => ({ name: m.name, duration: m.value }));
      const slowestOperation = durations.length > 0 
        ? durations.reduce((max, curr) => curr.duration > max.duration ? curr : max)
        : { name: 'N/A', duration: 0 };

      const fastestOperation = durations.length > 0
        ? durations.reduce((min, curr) => curr.duration < min.duration ? curr : min)
        : { name: 'N/A', duration: 0 };

      const operationBreakdown = this.getOperationBreakdown(metrics);

      return {
        context,
        totalOperations,
        averageResponseTime,
        errorRate,
        slowestOperation,
        fastestOperation,
        operationBreakdown
      };
    });
  }

  /**
   * Get event processing statistics
   */
  private getEventProcessingStats(): EventProcessingStats {
    const stats = eventProcessingMonitor.getEventStats();
    const bottlenecks = eventProcessingMonitor.detectBottlenecks();

    // Get event type breakdown
    const eventTypes = new Set<string>();
    // This would need to be implemented based on actual event tracking
    const eventTypeBreakdown: Array<{
      eventType: string;
      count: number;
      averageTime: number;
      errorRate: number;
    }> = [];

    return {
      totalEvents: stats.totalEvents,
      averageProcessingTime: stats.averageProcessingTime,
      successRate: stats.successRate,
      slowestEvent: stats.slowestEvent,
      fastestEvent: stats.fastestEvent,
      eventTypeBreakdown
    };
  }

  /**
   * Get system health metrics
   */
  private getSystemHealthMetrics(): SystemHealthMetrics {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      memoryUsage: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
      },
      uptime,
      activeConnections: 0, // Would need to be tracked separately
      requestsPerSecond: 0 // Would need to be calculated from metrics
    };
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(
    contexts: ContextMetrics[], 
    eventProcessing: EventProcessingStats
  ): string[] {
    const recommendations: string[] = [];

    // Check for slow contexts
    contexts.forEach(context => {
      if (context.averageResponseTime > 100) {
        recommendations.push(
          `${context.context} context has high average response time (${context.averageResponseTime.toFixed(2)}ms)`
        );
      }

      if (context.errorRate > 0.05) {
        recommendations.push(
          `${context.context} context has high error rate (${(context.errorRate * 100).toFixed(2)}%)`
        );
      }

      // Check for specific slow operations
      context.operationBreakdown.forEach(op => {
        if (op.averageDuration > 200) {
          recommendations.push(
            `Operation ${op.operation} in ${context.context} is slow (${op.averageDuration.toFixed(2)}ms)`
          );
        }
      });
    });

    // Check event processing
    if (eventProcessing.averageProcessingTime > 50) {
      recommendations.push(
        `Event processing is slow (${eventProcessing.averageProcessingTime.toFixed(2)}ms average)`
      );
    }

    if (eventProcessing.successRate < 0.95) {
      recommendations.push(
        `Event processing has low success rate (${(eventProcessing.successRate * 100).toFixed(2)}%)`
      );
    }

    // System health recommendations
    const systemHealth = this.getSystemHealthMetrics();
    if (systemHealth.memoryUsage.percentage > 80) {
      recommendations.push(
        `High memory usage (${systemHealth.memoryUsage.percentage.toFixed(2)}%)`
      );
    }

    return recommendations;
  }

  /**
   * Group metrics by context
   */
  private groupMetricsByContext(metrics: MetricData[]): Record<string, MetricData[]> {
    return metrics.reduce((groups, metric) => {
      if (!groups[metric.context]) {
        groups[metric.context] = [];
      }
      groups[metric.context].push(metric);
      return groups;
    }, {} as Record<string, MetricData[]>);
  }

  /**
   * Get operation breakdown for a context
   */
  private getOperationBreakdown(metrics: MetricData[]): Array<{
    operation: string;
    count: number;
    averageDuration: number;
    errorCount: number;
  }> {
    const operations = new Map<string, {
      durations: number[];
      calls: number;
      errors: number;
    }>();

    metrics.forEach(metric => {
      const operationName = metric.name.split('.')[0];
      
      if (!operations.has(operationName)) {
        operations.set(operationName, { durations: [], calls: 0, errors: 0 });
      }

      const operation = operations.get(operationName)!;

      if (metric.name.endsWith('.duration')) {
        operation.durations.push(metric.value);
      } else if (metric.name.endsWith('.calls')) {
        operation.calls += metric.value;
      } else if (metric.name.endsWith('.errors')) {
        operation.errors += metric.value;
      }
    });

    return Array.from(operations.entries()).map(([operation, data]) => ({
      operation,
      count: data.calls,
      averageDuration: data.durations.length > 0 
        ? data.durations.reduce((sum, d) => sum + d, 0) / data.durations.length 
        : 0,
      errorCount: data.errors
    }));
  }

  /**
   * Export metrics to JSON for external monitoring tools
   */
  exportMetrics(): string {
    return JSON.stringify(this.getDashboardMetrics(), null, 2);
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearAllMetrics(): void {
    performanceMetrics.clearMetrics();
  }
}

// Singleton instance
export const monitoringDashboard = new MonitoringDashboard();