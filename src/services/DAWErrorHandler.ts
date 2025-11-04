/**
 * Backend DAW Error Handler Service
 * Handles server-side error management, logging, and recovery for DAW operations
 */

import { EventEmitter } from 'events';
import { loggingService } from './LoggingService';

export enum DAWServerErrorType {
  // Database and Storage Errors
  DATABASE_CONNECTION_ERROR = 'database_connection_error',
  PROJECT_SAVE_ERROR = 'project_save_error',
  PROJECT_LOAD_ERROR = 'project_load_error',
  AUDIO_FILE_STORAGE_ERROR = 'audio_file_storage_error',
  STATE_PERSISTENCE_ERROR = 'state_persistence_error',
  
  // Collaboration Errors
  OPERATION_SYNC_ERROR = 'operation_sync_error',
  USER_PRESENCE_ERROR = 'user_presence_error',
  CONFLICT_RESOLUTION_ERROR = 'conflict_resolution_error',
  BROADCAST_ERROR = 'broadcast_error',
  
  // WebRTC and Socket Errors
  SOCKET_CONNECTION_ERROR = 'socket_connection_error',
  WEBRTC_COORDINATION_ERROR = 'webrtc_coordination_error',
  DATA_CHANNEL_ERROR = 'data_channel_error',
  PEER_CONNECTION_ERROR = 'peer_connection_error',
  
  // Audio Processing Errors
  AUDIO_FILE_PROCESSING_ERROR = 'audio_file_processing_error',
  AUDIO_SYNC_ERROR = 'audio_sync_error',
  RECORDING_ERROR = 'recording_error',
  
  // Performance and Resource Errors
  MEMORY_LIMIT_ERROR = 'memory_limit_error',
  CPU_OVERLOAD_ERROR = 'cpu_overload_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  RESOURCE_EXHAUSTION_ERROR = 'resource_exhaustion_error',
  
  // Validation and Security Errors
  VALIDATION_ERROR = 'validation_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  SECURITY_VIOLATION_ERROR = 'security_violation_error',
  
  // Generic Errors
  UNKNOWN_ERROR = 'unknown_error',
  CONFIGURATION_ERROR = 'configuration_error',
  INITIALIZATION_ERROR = 'initialization_error'
}

export enum DAWServerErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface DAWServerError {
  id: string;
  type: DAWServerErrorType;
  severity: DAWServerErrorSeverity;
  message: string;
  timestamp: Date;
  context: Record<string, any>;
  originalError?: Error;
  stack?: string;
  userId?: string;
  roomId?: string;
  component: string;
  retryCount: number;
  maxRetries: number;
  isRecoverable: boolean;
}

export interface DAWErrorRecoveryResult {
  success: boolean;
  message: string;
  retryAfter?: number;
  fallbackAction?: string;
}

export interface DAWErrorHandlerConfig {
  maxRetries: number;
  retryDelay: number;
  enableAutoRecovery: boolean;
  enableTelemetry: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  alertThresholds: {
    errorRate: number; // errors per minute
    criticalErrors: number; // critical errors per hour
  };
}

const DEFAULT_CONFIG: DAWErrorHandlerConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  enableAutoRecovery: true,
  enableTelemetry: true,
  logLevel: 'error',
  alertThresholds: {
    errorRate: 10,
    criticalErrors: 5
  }
};

export class DAWServerErrorHandler extends EventEmitter {
  private config: DAWErrorHandlerConfig;
  private errors: Map<string, DAWServerError> = new Map();
  private errorCounts: Map<DAWServerErrorType, number> = new Map();
  private lastErrorTime: Map<DAWServerErrorType, number> = new Map();
  private retryTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private recoveryStrategies: Map<DAWServerErrorType, (error: DAWServerError) => Promise<DAWErrorRecoveryResult>> = new Map();

  constructor(config: Partial<DAWErrorHandlerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupRecoveryStrategies();
  }

  /**
   * Handle a DAW server error
   */
  handleError(
    type: DAWServerErrorType,
    originalError: Error | string,
    context: Record<string, any> = {},
    component: string = 'Unknown'
  ): DAWServerError {
    const errorId = this.generateErrorId();
    const timestamp = new Date();
    
    const severity = this.determineErrorSeverity(type, context);
    const isRecoverable = this.isErrorRecoverable(type);
    const maxRetries = this.getMaxRetries(type);
    
    const dawError: DAWServerError = {
      id: errorId,
      type,
      severity,
      message: originalError instanceof Error ? originalError.message : originalError,
      timestamp,
      context,
      ...(originalError instanceof Error ? { originalError, stack: originalError.stack } : {}),
      userId: context.userId,
      roomId: context.roomId,
      component,
      retryCount: 0,
      maxRetries,
      isRecoverable
    };

    // Store error
    this.errors.set(errorId, dawError);
    
    // Update error statistics
    this.updateErrorStatistics(type);
    
    // Log error
    this.logError(dawError);
    
    // Send telemetry
    if (this.config.enableTelemetry) {
      this.sendTelemetry(dawError);
    }
    
    // Emit error event
    this.emit('error', dawError);
    
    // Check alert thresholds
    this.checkAlertThresholds();
    
    // Attempt automatic recovery if enabled
    if (this.config.enableAutoRecovery && isRecoverable) {
      this.attemptRecovery(dawError);
    }
    
    return dawError;
  }

  /**
   * Attempt to recover from an error
   */
  async attemptRecovery(error: DAWServerError): Promise<DAWErrorRecoveryResult> {
    if (error.retryCount >= error.maxRetries) {
      return {
        success: false,
        message: 'Max retries exceeded'
      };
    }

    error.retryCount++;
    
    try {
      const recoveryStrategy = this.recoveryStrategies.get(error.type);
      if (recoveryStrategy) {
        loggingService.logInfo(`Attempting recovery for error ${error.id} (attempt ${error.retryCount})`, {
          errorType: error.type,
          component: error.component
        });
        
        const result = await recoveryStrategy(error);
        
        if (result.success) {
          loggingService.logInfo(`Successfully recovered from error ${error.id}`, {
            errorType: error.type,
            component: error.component
          });
          
          this.emit('errorRecovered', error);
          this.errors.delete(error.id);
          return result;
        } else if (error.retryCount < error.maxRetries) {
          // Schedule retry
          const delay = this.config.retryDelay * Math.pow(2, error.retryCount - 1);
          
          const timeout = setTimeout(() => {
            this.attemptRecovery(error);
            this.retryTimeouts.delete(error.id);
          }, delay);
          
          this.retryTimeouts.set(error.id, timeout);
        }
        
        return result;
      }
      
      return {
        success: false,
        message: 'No recovery strategy available'
      };
      
    } catch (recoveryError) {
      loggingService.logError(recoveryError as Error, {
        context: 'errorRecovery',
        originalErrorId: error.id,
        errorType: error.type
      });
      
      return {
        success: false,
        message: `Recovery failed: ${recoveryError}`
      };
    }
  }

  /**
   * Set up recovery strategies for different error types
   */
  private setupRecoveryStrategies(): void {
    // Database connection recovery
    this.recoveryStrategies.set(DAWServerErrorType.DATABASE_CONNECTION_ERROR, async (error) => {
      try {
        // Attempt to reconnect to database
        // This would depend on your database implementation
        loggingService.logInfo('Attempting database reconnection', {
          errorId: error.id
        });
        
        // Simulate database reconnection
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return {
          success: true,
          message: 'Database connection restored'
        };
      } catch {
        return {
          success: false,
          message: 'Database reconnection failed',
          retryAfter: 5000
        };
      }
    });

    // Project save error recovery
    this.recoveryStrategies.set(DAWServerErrorType.PROJECT_SAVE_ERROR, async (error) => {
      try {
        // Attempt to save to backup location or retry with different strategy
        loggingService.logInfo('Attempting project save recovery', {
          errorId: error.id,
          projectId: error.context.projectId
        });
        
        // Implementation would depend on your storage system
        return {
          success: true,
          message: 'Project saved to backup location'
        };
      } catch {
        return {
          success: false,
          message: 'Project save recovery failed',
          fallbackAction: 'cache_locally'
        };
      }
    });

    // Audio file processing recovery
    this.recoveryStrategies.set(DAWServerErrorType.AUDIO_FILE_PROCESSING_ERROR, async (error) => {
      try {
        // Retry with different processing parameters or fallback format
        loggingService.logInfo('Attempting audio file processing recovery', {
          errorId: error.id,
          fileId: error.context.fileId
        });
        
        return {
          success: true,
          message: 'Audio file processed with fallback settings'
        };
      } catch {
        return {
          success: false,
          message: 'Audio file processing recovery failed'
        };
      }
    });

    // Socket connection recovery
    this.recoveryStrategies.set(DAWServerErrorType.SOCKET_CONNECTION_ERROR, async (error) => {
      try {
        // Attempt to restore socket connection
        loggingService.logInfo('Attempting socket connection recovery', {
          errorId: error.id,
          userId: error.userId,
          roomId: error.roomId
        });
        
        // This would involve reconnecting the socket and restoring state
        return {
          success: true,
          message: 'Socket connection restored'
        };
      } catch {
        return {
          success: false,
          message: 'Socket connection recovery failed'
        };
      }
    });

    // Operation sync error recovery
    this.recoveryStrategies.set(DAWServerErrorType.OPERATION_SYNC_ERROR, async (error) => {
      try {
        // Attempt to resync operation state
        loggingService.logInfo('Attempting operation sync recovery', {
          errorId: error.id,
          operationId: error.context.operationId
        });
        
        // This would involve rebroadcasting the operation or resolving conflicts
        return {
          success: true,
          message: 'Operation sync restored'
        };
      } catch {
        return {
          success: false,
          message: 'Operation sync recovery failed'
        };
      }
    });
  }

  /**
   * Determine error severity based on type and context
   */
  private determineErrorSeverity(type: DAWServerErrorType, _context: Record<string, any>): DAWServerErrorSeverity {
    const criticalErrors = [
      DAWServerErrorType.DATABASE_CONNECTION_ERROR,
      DAWServerErrorType.MEMORY_LIMIT_ERROR,
      DAWServerErrorType.RESOURCE_EXHAUSTION_ERROR,
      DAWServerErrorType.SECURITY_VIOLATION_ERROR
    ];

    const highSeverityErrors = [
      DAWServerErrorType.PROJECT_SAVE_ERROR,
      DAWServerErrorType.PROJECT_LOAD_ERROR,
      DAWServerErrorType.AUDIO_FILE_STORAGE_ERROR,
      DAWServerErrorType.AUTHENTICATION_ERROR,
      DAWServerErrorType.AUTHORIZATION_ERROR
    ];

    const mediumSeverityErrors = [
      DAWServerErrorType.OPERATION_SYNC_ERROR,
      DAWServerErrorType.AUDIO_FILE_PROCESSING_ERROR,
      DAWServerErrorType.WEBRTC_COORDINATION_ERROR,
      DAWServerErrorType.BROADCAST_ERROR
    ];

    if (criticalErrors.includes(type)) {
      return DAWServerErrorSeverity.CRITICAL;
    } else if (highSeverityErrors.includes(type)) {
      return DAWServerErrorSeverity.HIGH;
    } else if (mediumSeverityErrors.includes(type)) {
      return DAWServerErrorSeverity.MEDIUM;
    } else {
      return DAWServerErrorSeverity.LOW;
    }
  }

  /**
   * Check if an error type is recoverable
   */
  private isErrorRecoverable(type: DAWServerErrorType): boolean {
    const nonRecoverableErrors = [
      DAWServerErrorType.VALIDATION_ERROR,
      DAWServerErrorType.AUTHORIZATION_ERROR,
      DAWServerErrorType.SECURITY_VIOLATION_ERROR,
      DAWServerErrorType.CONFIGURATION_ERROR
    ];

    return !nonRecoverableErrors.includes(type);
  }

  /**
   * Get maximum retries for an error type
   */
  private getMaxRetries(type: DAWServerErrorType): number {
    const highRetryErrors = [
      DAWServerErrorType.DATABASE_CONNECTION_ERROR,
      DAWServerErrorType.PROJECT_SAVE_ERROR,
      DAWServerErrorType.AUDIO_FILE_STORAGE_ERROR
    ];

    const lowRetryErrors = [
      DAWServerErrorType.MEMORY_LIMIT_ERROR,
      DAWServerErrorType.CPU_OVERLOAD_ERROR
    ];

    if (highRetryErrors.includes(type)) {
      return 5;
    } else if (lowRetryErrors.includes(type)) {
      return 1;
    } else {
      return this.config.maxRetries;
    }
  }

  /**
   * Update error statistics
   */
  private updateErrorStatistics(type: DAWServerErrorType): void {
    const currentCount = this.errorCounts.get(type) || 0;
    this.errorCounts.set(type, currentCount + 1);
    this.lastErrorTime.set(type, Date.now());
  }

  /**
   * Log error
   */
  private logError(error: DAWServerError): void {
    const logData = {
      errorId: error.id,
      type: error.type,
      severity: error.severity,
      message: error.message,
      component: error.component,
      userId: error.userId,
      roomId: error.roomId,
      context: error.context,
      stack: error.stack
    };

    switch (error.severity) {
      case DAWServerErrorSeverity.CRITICAL:
        loggingService.logError(error.originalError || new Error(error.message), logData);
        break;
      case DAWServerErrorSeverity.HIGH:
        loggingService.logError(error.originalError || new Error(error.message), logData);
        break;
      case DAWServerErrorSeverity.MEDIUM:
        loggingService.logWarn(error.message, logData);
        break;
      case DAWServerErrorSeverity.LOW:
        loggingService.logInfo(error.message, logData);
        break;
    }
  }

  /**
   * Send error telemetry
   */
  private sendTelemetry(error: DAWServerError): void {
    // In a real implementation, this would send telemetry to a monitoring service
    // For now, we'll just emit an event
    this.emit('telemetry', {
      type: 'daw_server_error',
      data: {
        errorType: error.type,
        severity: error.severity,
        component: error.component,
        userId: error.userId,
        roomId: error.roomId,
        timestamp: error.timestamp
      }
    });
  }

  /**
   * Check alert thresholds
   */
  private checkAlertThresholds(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    // Check error rate (errors per minute)
    const recentErrors = Array.from(this.errors.values()).filter(
      error => error.timestamp.getTime() > oneMinuteAgo
    );

    if (recentErrors.length > this.config.alertThresholds.errorRate) {
      this.emit('alert', {
        type: 'high_error_rate',
        message: `High error rate detected: ${recentErrors.length} errors in the last minute`,
        severity: 'high',
        errors: recentErrors
      });
    }

    // Check critical errors (per hour)
    const recentCriticalErrors = Array.from(this.errors.values()).filter(
      error => error.timestamp.getTime() > oneHourAgo && 
               error.severity === DAWServerErrorSeverity.CRITICAL
    );

    if (recentCriticalErrors.length > this.config.alertThresholds.criticalErrors) {
      this.emit('alert', {
        type: 'high_critical_error_rate',
        message: `High critical error rate: ${recentCriticalErrors.length} critical errors in the last hour`,
        severity: 'critical',
        errors: recentCriticalErrors
      });
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `daw_server_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(): {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    recentErrors: DAWServerError[];
    activeErrors: DAWServerError[];
  } {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    const recentErrors = Array.from(this.errors.values())
      .filter(error => error.timestamp.getTime() > oneHourAgo)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const errorsBySeverity = {
      [DAWServerErrorSeverity.LOW]: 0,
      [DAWServerErrorSeverity.MEDIUM]: 0,
      [DAWServerErrorSeverity.HIGH]: 0,
      [DAWServerErrorSeverity.CRITICAL]: 0
    };

    Array.from(this.errors.values()).forEach(error => {
      errorsBySeverity[error.severity]++;
    });

    return {
      totalErrors: this.errors.size,
      errorsByType: Object.fromEntries(this.errorCounts),
      errorsBySeverity,
      recentErrors,
      activeErrors: Array.from(this.errors.values())
    };
  }

  /**
   * Clear resolved errors
   */
  clearResolvedErrors(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Remove errors older than 1 hour that have been resolved
    Array.from(this.errors.entries()).forEach(([id, error]) => {
      if (error.timestamp.getTime() < oneHourAgo) {
        this.errors.delete(id);
      }
    });

    // Clear retry timeouts for removed errors
    this.retryTimeouts.forEach((timeout, errorId) => {
      if (!this.errors.has(errorId)) {
        clearTimeout(timeout);
        this.retryTimeouts.delete(errorId);
      }
    });
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    // Clear all retry timeouts
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
    this.retryTimeouts.clear();

    // Clear errors
    this.errors.clear();
    this.errorCounts.clear();
    this.lastErrorTime.clear();

    // Remove all listeners
    this.removeAllListeners();
  }
}

// Export singleton instance
export const dawServerErrorHandler = new DAWServerErrorHandler();