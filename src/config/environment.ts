import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables based on NODE_ENV
// In Railway, environment variables are injected directly, so we only load local files in development
if (process.env.NODE_ENV !== 'production') {
  // Try .env.local first, then fall back to .env
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  const envPath = path.resolve(process.cwd(), '.env');
  
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const resolvePath = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};

const volumePath =
  resolvePath(process.env.RECORD_AUDIO_PATH) ||
  resolvePath(process.env.RAILWAY_VOLUME_MOUNT_PATH);
const recordingsDir = volumePath || path.join(process.cwd(), 'record-audio');

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
  
  // CORS configuration - simplified to use single FRONTEND_URL
  cors: {
    // Single frontend URL for CORS
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    // Development fallbacks for local development
    developmentOrigins: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'],
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
    // Performance tuning options
    maxConcurrentConnections: parseInt(process.env.MAX_CONCURRENT_CONNECTIONS || '1000'),
    connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '30000'),
    disableSynthRateLimit: process.env.DISABLE_SYNTH_RATE_LIMIT === 'true', // Disable rate limiting for synth params
    disableVoiceRateLimit: process.env.DISABLE_VOICE_RATE_LIMIT === 'true', // Disable rate limiting for voice events
  },

  storage: {
    recordingsDir,
    tempDir: path.join(process.cwd(), 'tmp', 'recordings'),
    publicBaseUrl: process.env.AUDIO_PUBLIC_BASE_URL,
  },
} as const;

export type Config = typeof config; 