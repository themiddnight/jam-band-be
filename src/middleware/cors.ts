import cors from 'cors';
import { config } from '../config/environment';

import { loggingService } from '../services/LoggingService';

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Log the origin for debugging
    loggingService.logSecurityEvent('CORS request', {
      origin,
      nodeEnv: config.nodeEnv,
      strictMode: config.cors.strictMode,
      frontendUrlEnv: process.env.FRONTEND_URL,
      configFrontendUrl: config.cors.frontendUrl
    });
    
    if (config.nodeEnv === 'production') {
      // Production mode - only allow the configured frontend URL
      if (!origin || origin === config.cors.frontendUrl) {
        loggingService.logSecurityEvent('CORS origin allowed', { origin, mode: 'production' });
        callback(null, true);
      } else {
        loggingService.logSecurityEvent('CORS origin blocked', {
          origin,
          expectedOrigin: config.cors.frontendUrl,
          mode: 'production'
        }, 'warn');
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development mode - allow frontend URL and local development origins
      const allowedOrigins = [config.cors.frontendUrl, ...config.cors.developmentOrigins];
      
      if (config.cors.strictMode) {
        // Strict development mode - only allow specified origins
        loggingService.logSecurityEvent('CORS strict development mode', { allowedOrigins });
        
        if (!origin || allowedOrigins.includes(origin)) {
          loggingService.logSecurityEvent('CORS origin allowed', { origin, mode: 'development-strict' });
          callback(null, true);
        } else {
          loggingService.logSecurityEvent('CORS origin blocked', {
            origin,
            allowedOrigins,
            mode: 'development-strict'
          }, 'warn');
          callback(new Error('Not allowed by CORS'));
        }
      } else {
        // Permissive development mode - allow all origins
        loggingService.logSecurityEvent('CORS permissive mode', { origin, mode: 'development-permissive' });
        callback(null, true);
      }
    }
  },
  credentials: config.cors.credentials,
  // Additional CORS options for better security
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400, // 24 hours
  // Handle preflight requests
  preflightContinue: false,
  optionsSuccessStatus: 200
};

export const corsMiddleware = cors(corsOptions);

// Simple CORS debugging middleware (no preflight handling)
export const corsDebugMiddleware = (req: any, res: any, next: any) => {
  loggingService.logSecurityEvent('CORS debug', {
    method: req.method,
    origin: req.get('Origin'),
    headers: req.headers
  });
  
  // Let the main CORS middleware handle everything
  next();
}; 