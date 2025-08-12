import cors from 'cors';
import { config } from '../config/environment';

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Log the origin for debugging
    console.log('🔒 CORS: Request origin:', origin);
    console.log('🔒 CORS: NODE_ENV:', config.nodeEnv);
    console.log('🔒 CORS: Strict mode:', config.cors.strictMode);
    console.log('🔒 CORS: FRONTEND_URL env var:', process.env.FRONTEND_URL);
    console.log('🔒 CORS: Config frontendUrl:', config.cors.frontendUrl);
    
    if (config.nodeEnv === 'production') {
      // Production mode - only allow the configured frontend URL
      if (!origin || origin === config.cors.frontendUrl) {
        console.log('✅ CORS: Production origin allowed:', origin);
        callback(null, true);
      } else {
        console.log('❌ CORS: Production origin blocked:', origin);
        console.log('❌ CORS: Expected origin:', config.cors.frontendUrl);
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // Development mode - allow frontend URL and local development origins
      const allowedOrigins = [config.cors.frontendUrl, ...config.cors.developmentOrigins];
      
      if (config.cors.strictMode) {
        // Strict development mode - only allow specified origins
        console.log('🔓 CORS: Strict development mode - allowed origins:', allowedOrigins);
        
        if (!origin || allowedOrigins.includes(origin)) {
          console.log('✅ CORS: Development origin allowed:', origin);
          callback(null, true);
        } else {
          console.log('❌ CORS: Development origin blocked:', origin);
          console.log('❌ CORS: Allowed development origins:', allowedOrigins);
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
  // Handle preflight requests
  preflightContinue: false,
  optionsSuccessStatus: 200
};

export const corsMiddleware = cors(corsOptions);

// Simple CORS debugging middleware (no preflight handling)
export const corsDebugMiddleware = (req: any, res: any, next: any) => {
  console.log('🔍 CORS Debug: Request method:', req.method);
  console.log('🔍 CORS Debug: Request origin:', req.get('Origin'));
  console.log('🔍 CORS Debug: Request headers:', req.headers);
  
  // Let the main CORS middleware handle everything
  next();
}; 