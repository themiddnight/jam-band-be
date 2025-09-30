import { Socket } from 'socket.io';
import { loggingService } from './LoggingService';

/**
 * Backend Error Recovery Service for comprehensive error handling
 * Requirements: 6.10 - Comprehensive error handling for namespace connection failures
 */

export enum BackendErrorType {
  NAMESPACE_CONNECTION_ERROR = 'namespace_connection_error',
  SESSION_MANAGEMENT_ERROR = 'session_management_error',
  ROOM_STATE_ERROR = 'room_state_error',
  VALIDATION_ERROR = 'validation_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  PERMISSION_ERROR = 'permission_error',
  DATABASE_ERROR = 'database_error',
  NETWORK_ERROR = 'network_error',
  UNKNOWN_ERROR = 'unknown_error'
}

export interface BackendErrorContext {
  errorType: BackendErrorType;
  message: string;
  originalError?: Error;
  socketId?: string;
  userId?: string;
  roomId?: string;
  namespace?: string;
  timestamp: number;
  additionalData?: Record<string, any>;
}

export interface ErrorRecoveryAction {
  action: 'disconnect_socket' | 'cleanup_session' | 'reset_room_state' | 'send_error_response' | 'log_only';
  delay?: number;
  data?: any;
}

export class BackendErrorRecoveryService {
  private errorHistory: BackendErrorContext[] = [];
  private readonly MAX_ERROR_HISTORY = 1000;
  private errorCounts = new Map<string, number>();
  private readonly ERROR_THRESHOLD = 10; // Max errors per minute per type
  private readonly ERROR_WINDOW_MS = 60000; // 1 minute

  /**
   * Handle an error with automatic recovery
   */
  async handleError(context: BackendErrorContext, socket?: Socket): Promise<void> {
    // Add to error history
    this.addToErrorHistory(context);

    // Log the error
    loggingService.logError(context.originalError || new Error(context.message), {
      errorType: context.errorType,
      socketId: context.socketId,
      userId: context.userId,
      roomId: context.roomId,
      namespace: context.namespace,
      additionalData: context.additionalData
    });

    // Check for error flooding
    if (this.isErrorFlooding(context)) {
      loggingService.logSystemHealth('error-recovery', 'warning', {
        message: 'Error flooding detected',
        errorType: context.errorType,
        count: this.getErrorCount(context.errorType)
      });
      return;
    }

    // Determine recovery action
    const recoveryAction = this.determineRecoveryAction(context);

    // Execute recovery action
    await this.executeRecoveryAction(recoveryAction, context, socket);
  }

  /**
   * Add error to history with cleanup
   */
  private addToErrorHistory(context: BackendErrorContext): void {
    this.errorHistory.push(context);

    // Keep only recent errors
    if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
      this.errorHistory = this.errorHistory.slice(-this.MAX_ERROR_HISTORY / 2);
    }

    // Update error counts
    const errorKey = `${context.errorType}-${Math.floor(context.timestamp / this.ERROR_WINDOW_MS)}`;
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

    // Clean up old error counts
    this.cleanupErrorCounts();
  }

  /**
   * Check if we're experiencing error flooding
   */
  private isErrorFlooding(context: BackendErrorContext): boolean {
    const currentWindow = Math.floor(context.timestamp / this.ERROR_WINDOW_MS);
    const errorKey = `${context.errorType}-${currentWindow}`;
    const count = this.errorCounts.get(errorKey) || 0;
    
    return count > this.ERROR_THRESHOLD;
  }

  /**
   * Get error count for a specific error type in current window
   */
  private getErrorCount(errorType: BackendErrorType): number {
    const currentWindow = Math.floor(Date.now() / this.ERROR_WINDOW_MS);
    const errorKey = `${errorType}-${currentWindow}`;
    return this.errorCounts.get(errorKey) || 0;
  }

  /**
   * Clean up old error counts
   */
  private cleanupErrorCounts(): void {
    const currentWindow = Math.floor(Date.now() / this.ERROR_WINDOW_MS);
    const keysToDelete: string[] = [];

    for (const [key] of this.errorCounts) {
      const parts = key.split('-');
      if (parts.length < 2 || !parts[1]) continue;
      
      const windowStr = parts[1];
      const window = parseInt(windowStr, 10);
      
      // Remove counts older than 5 minutes
      if (currentWindow - window > 5) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.errorCounts.delete(key));
  }

  /**
   * Determine appropriate recovery action
   */
  private determineRecoveryAction(context: BackendErrorContext): ErrorRecoveryAction {
    switch (context.errorType) {
      case BackendErrorType.NAMESPACE_CONNECTION_ERROR:
        return {
          action: 'send_error_response',
          data: {
            message: 'Connection error. Please try again.',
            code: 'CONNECTION_ERROR',
            retryAfter: 5
          }
        };

      case BackendErrorType.SESSION_MANAGEMENT_ERROR:
        return {
          action: 'cleanup_session',
          data: {
            message: 'Session error. Please reconnect.',
            code: 'SESSION_ERROR'
          }
        };

      case BackendErrorType.ROOM_STATE_ERROR:
        return {
          action: 'reset_room_state',
          data: {
            message: 'Room state error. Refreshing room data.',
            code: 'ROOM_STATE_ERROR'
          }
        };

      case BackendErrorType.VALIDATION_ERROR:
        return {
          action: 'send_error_response',
          data: {
            message: context.message || 'Invalid request data.',
            code: 'VALIDATION_ERROR'
          }
        };

      case BackendErrorType.RATE_LIMIT_ERROR:
        return {
          action: 'send_error_response',
          data: {
            message: 'Rate limit exceeded. Please slow down.',
            code: 'RATE_LIMITED',
            retryAfter: 10
          }
        };

      case BackendErrorType.PERMISSION_ERROR:
        return {
          action: 'send_error_response',
          data: {
            message: 'Permission denied.',
            code: 'PERMISSION_DENIED'
          }
        };

      case BackendErrorType.DATABASE_ERROR:
        return {
          action: 'send_error_response',
          data: {
            message: 'Server error. Please try again later.',
            code: 'SERVER_ERROR',
            retryAfter: 30
          }
        };

      case BackendErrorType.NETWORK_ERROR:
        return {
          action: 'send_error_response',
          data: {
            message: 'Network error. Please check your connection.',
            code: 'NETWORK_ERROR',
            retryAfter: 5
          }
        };

      default:
        return {
          action: 'send_error_response',
          data: {
            message: 'An unexpected error occurred.',
            code: 'UNKNOWN_ERROR',
            retryAfter: 10
          }
        };
    }
  }

  /**
   * Execute recovery action
   */
  private async executeRecoveryAction(
    action: ErrorRecoveryAction,
    context: BackendErrorContext,
    socket?: Socket
  ): Promise<void> {
    try {
      // Apply delay if specified
      if (action.delay) {
        await new Promise(resolve => setTimeout(resolve, action.delay));
      }

      switch (action.action) {
        case 'disconnect_socket':
          if (socket) {
            socket.disconnect(true);
            loggingService.logInfo('Socket disconnected due to error', {
              socketId: socket.id,
              errorType: context.errorType
            });
          }
          break;

        case 'cleanup_session':
          // Session cleanup would be handled by the session manager
          if (socket && action.data) {
            socket.emit('error', action.data);
            socket.disconnect(true);
          }
          break;

        case 'reset_room_state':
          // Room state reset would be handled by the room service
          if (socket && action.data) {
            socket.emit('room_state_reset', action.data);
          }
          break;

        case 'send_error_response':
          if (socket && action.data) {
            socket.emit('error', action.data);
          }
          break;

        case 'log_only':
          // Already logged above, no additional action needed
          break;

        default:
          loggingService.logSystemHealth('error-recovery', 'warning', {
            message: 'Unknown recovery action',
            action: action.action,
            errorType: context.errorType
          });
      }

      loggingService.logInfo('Recovery action executed', {
        action: action.action,
        errorType: context.errorType,
        socketId: context.socketId
      });

    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'Recovery action execution failed',
        originalErrorType: context.errorType,
        recoveryAction: action.action
      });
    }
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalErrors: number;
    errorsByType: Record<BackendErrorType, number>;
    recentErrors: BackendErrorContext[];
    errorRates: Record<BackendErrorType, number>;
  } {
    const errorsByType = this.errorHistory.reduce((acc, error) => {
      acc[error.errorType] = (acc[error.errorType] || 0) + 1;
      return acc;
    }, {} as Record<BackendErrorType, number>);

    const currentWindow = Math.floor(Date.now() / this.ERROR_WINDOW_MS);
    const errorRates: Record<BackendErrorType, number> = {} as any;
    
    Object.values(BackendErrorType).forEach(errorType => {
      const errorKey = `${errorType}-${currentWindow}`;
      errorRates[errorType] = this.errorCounts.get(errorKey) || 0;
    });

    return {
      totalErrors: this.errorHistory.length,
      errorsByType,
      recentErrors: this.errorHistory.slice(-20),
      errorRates
    };
  }

  /**
   * Check if system is healthy
   */
  isSystemHealthy(): boolean {
    const stats = this.getErrorStats();
    
    // Check if any error type is flooding
  for (const [ _errorType, rate] of Object.entries(stats.errorRates)) {
      if (rate > this.ERROR_THRESHOLD * 0.8) { // 80% of threshold
        return false;
      }
    }

    return true;
  }

  /**
   * Clear error history (for testing or manual intervention)
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
    this.errorCounts.clear();
    loggingService.logInfo('Error history cleared');
  }

  /**
   * Get health report
   */
  getHealthReport(): {
    isHealthy: boolean;
    totalErrors: number;
    criticalErrors: number;
    errorRates: Record<BackendErrorType, number>;
    recommendations: string[];
  } {
    const stats = this.getErrorStats();
    const isHealthy = this.isSystemHealthy();
    
    const criticalErrors = this.errorHistory.filter(error => 
      error.errorType === BackendErrorType.DATABASE_ERROR ||
      error.errorType === BackendErrorType.NAMESPACE_CONNECTION_ERROR
    ).length;

    const recommendations: string[] = [];
    
    if (stats.errorRates[BackendErrorType.RATE_LIMIT_ERROR] > 5) {
      recommendations.push('High rate limiting detected - consider adjusting rate limits');
    }
    
    if (stats.errorRates[BackendErrorType.DATABASE_ERROR] > 2) {
      recommendations.push('Database errors detected - check database connectivity');
    }
    
    if (stats.errorRates[BackendErrorType.NAMESPACE_CONNECTION_ERROR] > 3) {
      recommendations.push('Namespace connection issues - check server resources');
    }

    return {
      isHealthy,
      totalErrors: stats.totalErrors,
      criticalErrors,
      errorRates: stats.errorRates,
      recommendations
    };
  }
}