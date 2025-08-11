import cors from 'cors';
import { config } from '../config/environment';

export const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Log the origin for debugging
    console.log('🔒 CORS: Request origin:', origin);
    console.log('🔒 CORS: NODE_ENV:', config.nodeEnv);
    console.log('🔒 CORS: Strict mode:', config.cors.strictMode);
    console.log('🔒 CORS: CORS_ORIGIN env var:', process.env.CORS_ORIGIN);
    console.log('🔒 CORS: ALLOWED_ORIGINS env var:', process.env.ALLOWED_ORIGINS);
    console.log('🔒 CORS: Config allowedOrigins:', config.cors.allowedOrigins);
    
    // Fallback: Always allow the known frontend origin
    const knownFrontendOrigin = 'https://jam-band-fe.vercel.app';
    
    if (config.nodeEnv === 'production') {
      // Production mode - use environment-based allowed origins
      const allowedOrigins = config.cors.allowedOrigins;
      
      console.log('🔒 CORS: Production mode - allowed origins:', allowedOrigins);
      
      // Check if origin is in allowed origins or is the known frontend origin
      if (!origin || allowedOrigins.includes(origin) || origin === knownFrontendOrigin) {
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
  // Handle preflight requests
  preflightContinue: false,
  optionsSuccessStatus: 200
};

export const corsMiddleware = cors(corsOptions);

// Additional CORS debugging middleware
export const corsDebugMiddleware = (req: any, res: any, next: any) => {
  console.log('🔍 CORS Debug: Request method:', req.method);
  console.log('🔍 CORS Debug: Request origin:', req.get('Origin'));
  console.log('🔍 CORS Debug: Request headers:', req.headers);
  
  // Handle preflight requests explicitly
  if (req.method === 'OPTIONS') {
    console.log('🔍 CORS Debug: Handling preflight request');
    res.header('Access-Control-Allow-Origin', 'https://jam-band-fe.vercel.app');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    res.status(200).end();
    return;
  }
  
  next();
}; 