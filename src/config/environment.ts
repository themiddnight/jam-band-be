import dotenv from 'dotenv';
import path from 'path';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? 'env.production' : '.env.local';
dotenv.config({ path: envFile });

export const config = {
  // Server configuration
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // SSL configuration
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    keyPath: process.env.SSL_KEY_PATH || '.selfsigned/key.pem',
    certPath: process.env.SSL_CERT_PATH || '.selfsigned/cert.pem',
  },
  
  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
  
  // WebRTC configuration
  webrtc: {
    enabled: process.env.WEBRTC_ENABLED === 'true',
    requireHttps: process.env.WEBRTC_REQUIRE_HTTPS === 'true',
  },
  
  // Railway configuration
  railway: {
    url: process.env.RAILWAY_URL,
    service: process.env.RAILWAY_SERVICE,
  },
  
  // Database configuration (if needed in future)
  database: {
    url: process.env.DATABASE_URL,
  },
  
  // JWT configuration (if needed in future)
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
} as const;

export type Config = typeof config; 