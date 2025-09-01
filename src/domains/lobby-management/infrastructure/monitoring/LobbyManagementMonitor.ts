/**
 * Performance monitoring for Lobby Management bounded context
 * Requirements: 8.1, 8.2
 */

import { boundedContextMonitor } from '../../../../shared/infrastructure/monitoring';
import { performanceMetrics } from '../../../../shared/infrastructure/monitoring';

export class LobbyManagementMonitor {
  private static readonly CONTEXT_NAME = 'lobby-management';

  /**
   * Monitor room discovery operations
   */
  static async monitorRoomDiscovery<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.discovery',
      operation
    );
  }

  /**
   * Monitor room search operations
   */
  static async monitorRoomSearch<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.search',
      operation
    );
  }

  /**
   * Monitor room listing operations
   */
  static async monitorRoomListing<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.listing',
      operation
    );
  }

  /**
   * Monitor real-time room status updates
   */
  static async monitorRoomStatusUpdate<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.status.update',
      operation
    );
  }

  /**
   * Monitor lobby namespace operations
   */
  static async monitorLobbyNamespace<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'lobby.namespace',
      operation
    );
  }

  /**
   * Record search performance metrics
   */
  static recordSearchMetrics(searchTerm: string, resultCount: number, duration: number): void {
    performanceMetrics.recordDuration(
      'search.query',
      duration,
      this.CONTEXT_NAME,
      { 
        hasSearchTerm: searchTerm.length > 0 ? 'true' : 'false',
        resultCount: resultCount.toString()
      }
    );

    performanceMetrics.recordGauge(
      'search.results.count',
      resultCount,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record lobby connection metrics
   */
  static recordLobbyConnections(count: number): void {
    performanceMetrics.recordGauge(
      'lobby.connections.count',
      count,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record room listing cache performance
   */
  static recordCachePerformance(cacheHit: boolean, duration: number): void {
    performanceMetrics.recordDuration(
      'cache.access',
      duration,
      this.CONTEXT_NAME,
      { hit: cacheHit ? 'true' : 'false' }
    );

    performanceMetrics.recordCounter(
      cacheHit ? 'cache.hits' : 'cache.misses',
      1,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record lobby memory usage
   */
  static recordLobbyMemoryUsage(memoryUsage: number): void {
    boundedContextMonitor.recordMemoryUsage(this.CONTEXT_NAME, memoryUsage);
  }

  /**
   * Get lobby management specific metrics
   */
  static getMetrics() {
    return {
      contextMetrics: boundedContextMonitor.getContextMetrics(this.CONTEXT_NAME),
      operationHistory: boundedContextMonitor.getOperationHistory(this.CONTEXT_NAME),
      globalMetrics: performanceMetrics.getMetrics(this.CONTEXT_NAME)
    };
  }
}