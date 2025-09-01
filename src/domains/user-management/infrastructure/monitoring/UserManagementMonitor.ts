/**
 * Performance monitoring for User Management bounded context
 * Requirements: 8.1, 8.2
 */

import { boundedContextMonitor } from '../../../../shared/infrastructure/monitoring';
import { performanceMetrics } from '../../../../shared/infrastructure/monitoring';

export class UserManagementMonitor {
  private static readonly CONTEXT_NAME = 'user-management';

  /**
   * Monitor user authentication operations
   */
  static async monitorAuthentication<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'user.authentication',
      operation
    );
  }

  /**
   * Monitor user profile operations
   */
  static async monitorUserProfile<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'user.profile',
      operation
    );
  }

  /**
   * Monitor permission checking operations
   */
  static async monitorPermissionCheck<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'permission.check',
      operation
    );
  }

  /**
   * Monitor approval workflow operations
   */
  static async monitorApprovalWorkflow<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'approval.workflow',
      operation
    );
  }

  /**
   * Monitor user session operations
   */
  static async monitorUserSession<T>(operation: () => Promise<T>): Promise<T> {
    return await boundedContextMonitor.monitorOperation(
      this.CONTEXT_NAME,
      'user.session',
      operation
    );
  }

  /**
   * Record user authentication metrics
   */
  static recordAuthenticationMetrics(success: boolean, method: string, duration: number): void {
    performanceMetrics.recordDuration(
      'authentication.duration',
      duration,
      this.CONTEXT_NAME,
      { 
        method,
        success: success ? 'true' : 'false'
      }
    );

    performanceMetrics.recordCounter(
      success ? 'authentication.success' : 'authentication.failure',
      1,
      this.CONTEXT_NAME,
      { method }
    );
  }

  /**
   * Record active user sessions
   */
  static recordActiveUserSessions(count: number): void {
    performanceMetrics.recordGauge(
      'user.sessions.active.count',
      count,
      this.CONTEXT_NAME
    );
  }

  /**
   * Record permission check performance
   */
  static recordPermissionCheckMetrics(
    permissionType: string,
    duration: number,
    cacheHit: boolean
  ): void {
    performanceMetrics.recordDuration(
      'permission.check.duration',
      duration,
      this.CONTEXT_NAME,
      { 
        permissionType,
        cacheHit: cacheHit ? 'true' : 'false'
      }
    );

    performanceMetrics.recordCounter(
      cacheHit ? 'permission.cache.hits' : 'permission.cache.misses',
      1,
      this.CONTEXT_NAME,
      { permissionType }
    );
  }

  /**
   * Record approval workflow metrics
   */
  static recordApprovalWorkflowMetrics(
    workflowType: string,
    duration: number,
    outcome: 'approved' | 'rejected' | 'timeout'
  ): void {
    performanceMetrics.recordDuration(
      'approval.workflow.duration',
      duration,
      this.CONTEXT_NAME,
      { workflowType, outcome }
    );

    performanceMetrics.recordCounter(
      `approval.workflow.${outcome}`,
      1,
      this.CONTEXT_NAME,
      { workflowType }
    );
  }

  /**
   * Record user profile update metrics
   */
  static recordProfileUpdateMetrics(updateType: string, success: boolean): void {
    performanceMetrics.recordCounter(
      success ? 'profile.update.success' : 'profile.update.failure',
      1,
      this.CONTEXT_NAME,
      { updateType }
    );
  }

  /**
   * Record user management memory usage
   */
  static recordUserManagementMemoryUsage(memoryUsage: number): void {
    boundedContextMonitor.recordMemoryUsage(this.CONTEXT_NAME, memoryUsage);
  }

  /**
   * Record concurrent user operations
   */
  static recordConcurrentOperations(operationType: string, count: number): void {
    performanceMetrics.recordGauge(
      'user.operations.concurrent',
      count,
      this.CONTEXT_NAME,
      { operationType }
    );
  }

  /**
   * Get user management specific metrics
   */
  static getMetrics() {
    return {
      contextMetrics: boundedContextMonitor.getContextMetrics(this.CONTEXT_NAME),
      operationHistory: boundedContextMonitor.getOperationHistory(this.CONTEXT_NAME),
      globalMetrics: performanceMetrics.getMetrics(this.CONTEXT_NAME)
    };
  }
}