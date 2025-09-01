/**
 * Performance monitoring for Room Management bounded context
 * Requirements: 8.1, 8.2
 */

import { boundedContextMonitor } from '../../../../shared/infrastructure/monitoring';
import { performanceMetrics } from '../../../../shared/infrastructure/monitoring';

export class RoomManagementMonitor {
  private static readonly CONTEXT_NAME = 'room-management';

  /**
   * Monitor room creation operations
   */
  static async monitorRoomCreation<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.create',
      operation
    );
  }

  /**
   * Monitor room join operations
   */
  static async monitorRoomJoin<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.join',
      operation
    );
  }

  /**
   * Monitor room leave operations
   */
  static async monitorRoomLeave<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.leave',
      operation
    );
  }

  /**
   * Monitor member management operations
   */
  static async monitorMemberManagement<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'member.management',
      operation
    );
  }

  /**
   * Monitor room settings updates
   */
  static async monitorRoomSettings<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'room.settings',
      operation
    );
  }

  /**
   * Monitor repository operations
   */
  static async monitorRepositoryOperation<T>(
    repositoryName: string,
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      `repository.${repositoryName}.${operationName}`,
      operation
    );
  }

  /**
   * Record room count metrics
   */
  static recordRoomCount(count: number): void {
    performanceMetrics.recordGauge(
      'rooms.active.count',
      count,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record member count metrics
   */
  static recordMemberCount(roomId: string, count: number): void {
    performanceMetrics.recordGauge(
      'room.members.count',
      count,
      this.CONTEXT_NAME,
      { roomId }
    );
  }

  /**
   * Record room memory usage
   */
  static recordRoomMemoryUsage(memoryUsage: number): void {
    boundedContextMonitor.recordMemoryUsage(this.CONTEXT_NAME, memoryUsage);
  }

  /**
   * Get room management specific metrics
   */
  static getMetrics() {
    return {
      contextMetrics: boundedContextMonitor.getContextMetrics(this.CONTEXT_NAME),
      operationHistory: boundedContextMonitor.getOperationHistory(this.CONTEXT_NAME),
      globalMetrics: performanceMetrics.getMetrics(this.CONTEXT_NAME)
    };
  }
}