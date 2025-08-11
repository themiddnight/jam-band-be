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
    // Single origin (legacy support)
    origin: process.env.CORS_ORIGIN || '*',
    // Multiple origins (new approach)
    allowedOrigins: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
      : ['http://localhost:5173', 'http://localhost:3000'],
    // Development origins (always allowed in dev mode)
    developmentOrigins: process.env.DEVELOPMENT_ORIGINS
      ? process.env.DEVELOPMENT_ORIGINS.split(',').map(origin => origin.trim())
      : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'],
    credentials: process.env.CORS_CREDENTIALS === 'true',
    // CORS policy configuration
    strictMode: process.env.CORS_STRICT_MODE === 'true',
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
  
  // Performance configuration
  performance: {
    enableCompression: process.env.ENABLE_COMPRESSION !== 'false', // Default true
    enableCaching: process.env.ENABLE_CACHING !== 'false', // Default true
    cacheTTL: parseInt(process.env.CACHE_TTL || '300'),
    maxConnections: parseInt(process.env.MAX_CONNECTIONS || '1000'),
    enableGarbageCollection: process.env.ENABLE_GC === 'true',
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '1800000'), // 30 minutes
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL || '300000'), // 5 minutes
    disableSynthRateLimit: process.env.DISABLE_SYNTH_RATE_LIMIT === 'true', // Disable rate limiting for synth params
  },
} as const;

export type Config = typeof config; 