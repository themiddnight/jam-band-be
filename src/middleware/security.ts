import { Request, Response, NextFunction } from 'express';
import { Socket } from 'socket.io';
import { validateData } from '../validation/schemas';
import { checkSocketRateLimit } from './rateLimit';
import { validateWebRTCRequest } from '../security/webrtcValidation';
import { loggingService } from '../services/LoggingService';

// HTTP request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  // Log request start
  loggingService.logHttpRequest(req, res, 0, 0);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    loggingService.logHttpRequest(req, res, duration, res.statusCode);
  });

  next();
};

// Socket connection security middleware
export const socketSecurityMiddleware = (socket: Socket, next: (err?: Error) => void): void => {
  const clientInfo = {
    socketId: socket.id,
    ip: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent'],
    timestamp: new Date().toISOString()
  };

  // Log connection attempt
  loggingService.logSocketEvent('connection_attempt', socket, clientInfo);

  // Basic connection validation
  if (!socket.handshake.address) {
    loggingService.logSecurityEvent('Socket connection without IP address', clientInfo, 'warn');
    return next(new Error('Invalid connection'));
  }

  // Check for suspicious user agents
  const userAgent = socket.handshake.headers['user-agent'] || '';
  const suspiciousUserAgents = [
    'curl', 'wget', 'python', 'bot', 'crawler', 'spider'
  ];

  const isSuspicious = suspiciousUserAgents.some(agent => 
    userAgent.toLowerCase().includes(agent)
  );

  if (isSuspicious) {
    loggingService.logSecurityEvent('Suspicious user agent detected', {
      ...clientInfo,
      userAgent,
      reason: 'Suspicious user agent'
    }, 'warn');
    // Don't block, just log for monitoring
  }

  // Allow connection
  next();
};

// Socket event security wrapper
export const secureSocketEvent = (
  eventName: string,
  validationSchema: any,
  handler: (socket: Socket, data: any) => void
) => {
  return (socket: Socket, data: any) => {
    const startTime = Date.now();
    
    // Log event
    loggingService.logSocketEvent(eventName, socket, data);

    try {
      // Rate limiting check
      const rateLimitResult = checkSocketRateLimit(socket, eventName);
      if (!rateLimitResult.allowed) {
        loggingService.logSecurityEvent('Rate limit exceeded', {
          socketId: socket.id,
          userId: socket.data?.userId,
          eventName,
          retryAfter: rateLimitResult.retryAfter
        }, 'warn');
        
        socket.emit('error', { 
          message: 'Rate limit exceeded', 
          retryAfter: rateLimitResult.retryAfter 
        });
        return;
      }

      // Input validation
      if (validationSchema) {
        const validationResult = validateData(validationSchema, data);
        if (validationResult.error) {
          loggingService.logValidationFailure(eventName, data, [validationResult.error]);
          
          socket.emit('error', { 
            message: 'Invalid data format', 
            details: validationResult.error 
          });
          return;
        }
        
        // Use validated data
        data = validationResult.value;
      }

      // WebRTC specific validation
      if (eventName.startsWith('voice_')) {
        const webrtcEventType = eventName === 'voice_offer' ? 'offer' : 
                               eventName === 'voice_answer' ? 'answer' : 
                               eventName === 'voice_ice_candidate' ? 'ice-candidate' : null;
        
        if (webrtcEventType) {
          const webrtcValidation = validateWebRTCRequest(socket, webrtcEventType, data);
          if (!webrtcValidation.isValid) {
            // Use different log levels based on error type
            const logLevel = webrtcValidation.error === 'User not authenticated' ? 'debug' : 'warn';
            
            loggingService.logSecurityEvent('WebRTC validation failed', {
              socketId: socket.id,
              userId: socket.data?.userId,
              eventName,
              error: webrtcValidation.error
            }, logLevel);
            
            socket.emit('error', { 
              message: 'WebRTC validation failed', 
              details: webrtcValidation.error 
            });
            return;
          }
        }
      }

      // Execute handler with validated data
      const result = handler(socket, data);
      
      // Log successful execution
      const duration = Date.now() - startTime;
      loggingService.logSocketEvent(eventName, socket, data, duration);

      return result;

    } catch (error) {
      // Log errors
      loggingService.logError(error as Error, {
        socketId: socket.id,
        userId: socket.data?.userId,
        eventName
      });

      // Send error to client
      socket.emit('error', { 
        message: 'Internal server error',
        eventName 
      });
    }
  };
};

// Security headers middleware
export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  // Additional security headers beyond Helmet
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};

// Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  // Basic input sanitization for HTTP requests
  if (req.body) {
    // Remove any potential script tags from string fields
    const sanitizeString = (str: string): string => {
      return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    };

    const sanitizeObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return sanitizeString(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      }
      if (obj && typeof obj === 'object') {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitizeObject(value);
        }
        return sanitized;
      }
      return obj;
    };

    req.body = sanitizeObject(req.body);
  }

  next();
}; 