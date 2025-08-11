import cors from 'cors';
import { config } from '../config/environment';

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Log the origin for debugging
    console.log('🔒 CORS: Request origin:', origin);
    console.log('🔒 CORS: NODE_ENV:', config.nodeEnv);
    console.log('🔒 CORS: Strict mode:', config.cors.strictMode);
    
    if (config.nodeEnv === 'production') {
      // Production mode - use environment-based allowed origins
      const allowedOrigins = config.cors.allowedOrigins;
      
      console.log('🔒 CORS: Production mode - allowed origins:', allowedOrigins);
      
      if (!origin || allowedOrigins.includes(origin)) {
        console.log('✅ CORS: Origin allowed:', origin);
        callback(null, true);
      } else {
        console.log('❌ CORS: Origin blocked:', origin);
        console.log('❌ CORS: Allowed origins:', allowedOrigins);
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development mode - use environment-based development origins or allow all
      if (config.cors.strictMode) {
        // Strict development mode - only allow specified development origins
        const devOrigins = config.cors.developmentOrigins;
        console.log('🔓 CORS: Strict development mode - allowed origins:', devOrigins);
        
        if (!origin || devOrigins.includes(origin)) {
          console.log('✅ CORS: Development origin allowed:', origin);
          callback(null, true);
        } else {
          console.log('❌ CORS: Development origin blocked:', origin);
          console.log('❌ CORS: Allowed development origins:', devOrigins);
          callback(new Error('Not allowed by CORS in strict development mode'));
        }
      } else {
        // Flexible development mode - allow all origins
        console.log('🔓 CORS: Flexible development mode - allowing all origins');
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
};

export const corsMiddleware = cors(corsOptions); 