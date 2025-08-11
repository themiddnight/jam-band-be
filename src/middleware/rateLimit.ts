import rateLimit from 'express-rate-limit';
import { Socket } from 'socket.io';
import { Request, Response } from 'express';
import { loggingService } from '../services/LoggingService';
import { config } from '../config/environment';

// HTTP API rate limiting
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req: Request, res: Response) => {
    // Log rate limit violation
    loggingService.logSecurityEvent('HTTP Rate Limit Exceeded', {
      ip: req.ip,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
    }, 'warn');

    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Socket rate limiting configuration
export interface RateLimitConfig {
  maxEvents: number;
  windowMs: number;
  eventType: 'note' | 'chat' | 'voice' | 'general';
}

// Music-friendly rate limits
export const socketRateLimits: Record<string, RateLimitConfig> = {
  // Note events - allow high frequency for music performance
  'play_note': {
    maxEvents: 1000, // 1000 notes per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'note'
  },
  
  // Chat messages - moderate limit
  'chat_message': {
    maxEvents: 30, // 30 messages per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'chat'
  },
  
  // Voice events - moderate limit
  'voice_offer': {
    maxEvents: 20, // 20 offers per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },
  'voice_answer': {
    maxEvents: 20, // 20 answers per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },
  'voice_ice_candidate': {
    maxEvents: 100, // 100 ICE candidates per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'voice'
  },
  
  // General events - lower limits
  'create_room': {
    maxEvents: 5, // 5 rooms per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },
  'join_room': {
    maxEvents: 20, // 20 room joins per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },
  'change_instrument': {
    maxEvents: 60, // 60 instrument changes per minute per user
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  },
  
  // Synth parameters - HIGH frequency for real-time knob control
  'update_synth_params': {
    maxEvents: 3600, // 3600 updates per minute per user (60 per second)
    windowMs: 60 * 1000, // 1 minute
    eventType: 'general'
  }
};

// Socket rate limiting storage
const socketRateLimitStore = new Map<string, Map<string, { count: number; resetTime: number }>>();

// Check if socket event is within rate limit
export const checkSocketRateLimit = (socket: Socket, eventName: string): { allowed: boolean; retryAfter?: number } => {
  // Special bypass for synth parameters - never rate limit these for real-time knob control
  if (eventName === 'update_synth_params' && config.performance.disableSynthRateLimit) {
    return { allowed: true };
  }
  
  const rateLimitConfig = socketRateLimits[eventName];
  if (!rateLimitConfig) {
    // No rate limit configured for this event
    return { allowed: true };
  }

  const userId = socket.data?.userId || socket.id;
  const now = Date.now();
  
  // Initialize user's rate limit tracking
  if (!socketRateLimitStore.has(userId)) {
    socketRateLimitStore.set(userId, new Map());
  }
  
  const userLimits = socketRateLimitStore.get(userId)!;
  
  // Get or create event limit tracking
  if (!userLimits.has(eventName)) {
    userLimits.set(eventName, { count: 0, resetTime: now + rateLimitConfig.windowMs });
  }
  
  const eventLimit = userLimits.get(eventName)!;
  
  // Check if window has reset
  if (now > eventLimit.resetTime) {
    eventLimit.count = 0;
    eventLimit.resetTime = now + rateLimitConfig.windowMs;
  }
  
  // Check if limit exceeded
  if (eventLimit.count >= rateLimitConfig.maxEvents) {
    const retryAfter = Math.ceil((eventLimit.resetTime - now) / 1000);
    
    // Log rate limit violation
    loggingService.logRateLimitViolation(userId, eventName, rateLimitConfig.maxEvents, rateLimitConfig.windowMs);
    
    return { allowed: false, retryAfter };
  }
  
  // Increment counter
  eventLimit.count++;
  return { allowed: true };
};

// Clean up expired rate limit entries
export const cleanupExpiredRateLimits = (): void => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [userId, userLimits] of socketRateLimitStore.entries()) {
    for (const [eventName, limit] of userLimits.entries()) {
      if (now > limit.resetTime) {
        userLimits.delete(eventName);
        cleanedCount++;
      }
    }
    
    // Remove user if no events left
    if (userLimits.size === 0) {
      socketRateLimitStore.delete(userId);
    }
  }
  
  if (cleanedCount > 0) {
    loggingService.logPerformanceMetric('rate_limit_cleanup', cleanedCount, {
      activeUsers: socketRateLimitStore.size,
      timestamp: new Date().toISOString()
    });
  }
};

// Run cleanup every 5 minutes
setInterval(cleanupExpiredRateLimits, 5 * 60 * 1000); 