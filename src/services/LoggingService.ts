import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { config } from '../config/environment';

// Log levels configuration
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Log colors for console output
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to Winston
winston.addColors(logColors);

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');

// Custom format for logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }: any) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return log;
  })
);

// Create Winston logger
export const logger = winston.createLogger({
  levels: logLevels,
  level: config.logging.level,
  format: logFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat,
      level: config.nodeEnv === 'development' ? 'debug' : 'info',
    }),
    
    // Error log file (daily rotation)
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
    
    // Combined log file (daily rotation)
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
    
    // HTTP requests log file (daily rotation)
    new DailyRotateFile({
      filename: path.join(logsDir, 'http-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'http',
      maxSize: '20m',
      maxFiles: '7d',
      zippedArchive: true,
    }),
    
    // Security events log file (daily rotation)
    new DailyRotateFile({
      filename: path.join(logsDir, 'security-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
});

// Logging service class for structured logging
export class LoggingService {
  private static instance: LoggingService;
  
  private constructor() {}
  
  static getInstance(): LoggingService {
    if (!LoggingService.instance) {
      LoggingService.instance = new LoggingService();
    }
    return LoggingService.instance;
  }

  // HTTP request logging
  logHttpRequest(req: any, res: any, duration: number, statusCode: number): void {
    const logData = {
      method: req.method,
      url: req.url,
      statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer'),
      timestamp: new Date().toISOString(),
      userId: req.userId || 'anonymous',
      sessionId: req.sessionId || 'none',
    };

    if (statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  }

  // Socket event logging
  logSocketEvent(eventName: string, socket: any, data: any, duration?: number, error?: any): void {
    const logData = {
      event: eventName,
      socketId: socket.id,
      userId: socket.data?.userId || 'anonymous',
      roomId: socket.data?.roomId || 'none',
      ip: socket.handshake?.address,
      userAgent: socket.handshake?.headers['user-agent'],
      data: data ? JSON.stringify(data).substring(0, 500) : undefined,
      duration: duration ? `${duration}ms` : undefined,
      error: error ? (error instanceof Error ? error.message : String(error)) : undefined,
      timestamp: new Date().toISOString(),
    };

    if (error) {
      logger.error('Socket Event Error', logData);
    } else if (duration && duration > 1000) {
      logger.warn('Slow Socket Event', logData);
    } else {
      logger.info('Socket Event', logData);
    }
  }

  // Security event logging
  logSecurityEvent(event: string, details: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    const logData = {
      securityEvent: event,
      ...details,
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
    };

    switch (level) {
      case 'error':
        logger.error('Security Event', logData);
        break;
      case 'warn':
        logger.warn('Security Event', logData);
        break;
      default:
        logger.info('Security Event', logData);
    }
  }

  // Rate limit violation logging
  logRateLimitViolation(identifier: string, eventType: string, limit: number, window: number): void {
    this.logSecurityEvent('Rate Limit Violation', {
      identifier,
      eventType,
      limit,
      window: `${window}ms`,
      ip: identifier.includes('.') ? identifier : undefined,
      userId: identifier.includes('.') ? undefined : identifier,
    }, 'warn');
  }

  // Validation failure logging
  logValidationFailure(event: string, data: any, errors: string[]): void {
    this.logSecurityEvent('Validation Failure', {
      event,
      data: JSON.stringify(data).substring(0, 200),
      errors,
    }, 'warn');
  }

  // Performance monitoring
  logPerformanceMetric(metric: string, value: number, context: any = {}): void {
    logger.info('Performance Metric', {
      metric,
      value,
      unit: 'ms',
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Error logging with context
  logError(error: Error, context: any = {}): void {
    logger.error('Application Error', {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Info logging
  logInfo(message: string, context: any = {}): void {
    logger.info('Info', {
      message,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // Room activity logging
  logRoomActivity(activity: string, roomId: string, userId: string, details: any = {}): void {
    logger.info('Room Activity', {
      activity,
      roomId,
      userId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // User activity logging
  logUserActivity(activity: string, userId: string, details: any = {}): void {
    logger.info('User Activity', {
      activity,
      userId,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // System health logging
  logSystemHealth(component: string, status: 'healthy' | 'warning' | 'error', details: any = {}): void {
    const level = status === 'error' ? 'error' : status === 'warning' ? 'warn' : 'info';
    
    logger[level]('System Health', {
      component,
      status,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  // Cleanup old log files
  async cleanupOldLogs(): Promise<void> {
    try {
      // Winston handles rotation automatically, but we can add custom cleanup logic here
      logger.info('Log cleanup completed', { timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('Log cleanup failed', { 
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString() 
      });
    }
  }
}

// Export singleton instance
export const loggingService = LoggingService.getInstance();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  logger.end();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  logger.end();
}); 