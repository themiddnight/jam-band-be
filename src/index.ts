import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import path from 'path';

// Import our modular components
import { config } from './config/environment';
import { corsMiddleware } from './middleware/cors';
import { apiLimiter, cleanupExpiredRateLimits } from './middleware/rateLimit';
import { 
  requestLogger, 
  securityHeaders, 
  sanitizeInput 
} from './middleware/security';
import { 
  requestMonitor, 
  performanceMonitor, 
  errorMonitor 
} from './middleware/monitoring';
import { compressionMiddleware } from './middleware/compression';
import { createSocketServer } from './config/socket';
import { createRoutes } from './routes';
import { RoomService } from './services/RoomService';
import { RoomHandlers } from './handlers/RoomHandlers';
import { SocketManager } from './socket/socketManager';
import { loggingService } from './services/LoggingService';

const app = express();

// Determine server type based on environment
let server;
let io;

if (config.nodeEnv === 'development' && config.ssl.enabled) {
  // Development mode - use HTTPS for WebRTC
  try {
    const keyPath = path.join(__dirname, '..', config.ssl.keyPath);
    const certPath = path.join(__dirname, '..', config.ssl.certPath);
    
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      server = createHttpsServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      }, app);
      loggingService.logInfo('Development: Using HTTPS with self-signed certificates');
    } else {
      throw new Error('SSL certificates not found');
    }
  } catch (error) {
    loggingService.logError(error as Error, { context: 'SSL setup' });
    loggingService.logInfo('SSL certificates not found, falling back to HTTP');
    loggingService.logInfo('WebRTC may not work properly in development');
    server = createServer(app);
  }
} else {
  // Production mode or HTTP only - use HTTP (Railway will handle SSL termination)
  server = createServer(app);
  if (config.nodeEnv === 'production') {
    loggingService.logInfo('Production: Using HTTP (SSL handled by Railway)');
  } else {
    loggingService.logInfo('Development: Using HTTP mode');
  }
}

io = createSocketServer(server);

// Initialize services
const roomService = new RoomService();
const roomHandlers = new RoomHandlers(roomService, io);
const socketManager = new SocketManager(io, roomHandlers);

// Security middleware (order matters!)
app.use(helmet());
app.use(securityHeaders);

// Compression middleware (should be early in the chain)
app.use(compressionMiddleware);

// Monitoring middleware (order matters!)
app.use(requestMonitor);
app.use(performanceMonitor);

// Security middleware
app.use(requestLogger);
app.use(corsMiddleware);

// Rate limiting for API endpoints
app.use('/api', apiLimiter);

// Body parsing and sanitization with optimized limits
app.use(express.json({ 
  limit: '1mb',
  strict: true,
  verify: (req, res, buf) => {
    // Store raw body for potential verification
    (req as any).rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '100kb' 
}));

app.use(sanitizeInput);

// Routes
app.use('/api', createRoutes(roomHandlers));

// Error monitoring middleware (must be last)
app.use(errorMonitor);

// Initialize socket manager
socketManager.initialize();

// Log application startup
loggingService.logInfo('Application starting up', {
  environment: config.nodeEnv,
  port: config.port,
  sslEnabled: config.ssl.enabled,
  timestamp: new Date().toISOString()
});

// Periodic cleanup tasks
setInterval(() => {
  roomService.cleanupExpiredGraceTime();
}, 30000); // Run every 30 seconds

// Clean up expired rate limit entries
setInterval(cleanupExpiredRateLimits, 5 * 60 * 1000); // Run every 5 minutes

// Log cleanup task
setInterval(() => {
  loggingService.cleanupOldLogs();
}, 60 * 60 * 1000); // Run every hour

// Memory optimization: Force garbage collection in development
if (config.nodeEnv === 'development' && config.performance.enableGarbageCollection) {
  setInterval(() => {
    if (global.gc) {
      const memBefore = process.memoryUsage();
      global.gc();
      const memAfter = process.memoryUsage();
      
      loggingService.logPerformanceMetric('garbage_collection', Date.now(), {
        memoryBefore: {
          heapUsed: Math.round(memBefore.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memBefore.heapTotal / 1024 / 1024),
          rss: Math.round(memBefore.rss / 1024 / 1024)
        },
        memoryAfter: {
          heapUsed: Math.round(memAfter.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memAfter.heapTotal / 1024 / 1024),
          rss: Math.round(memAfter.rss / 1024 / 1024)
        },
        freed: Math.round((memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024),
        timestamp: new Date().toISOString()
      });
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

server.listen(config.port, () => {
  const protocol = config.nodeEnv === 'development' && config.ssl.enabled ? 'https' : 'http';
  
  loggingService.logInfo('Server started successfully', {
    port: config.port,
    protocol,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString()
  });
  
  loggingService.logInfo('Security features enabled', {
    features: ['Rate limiting', 'Input validation', 'WebRTC validation', 'Comprehensive logging', 'Performance monitoring'],
    timestamp: new Date().toISOString()
  });
  
  if (config.nodeEnv === 'development' && config.ssl.enabled) {
    loggingService.logInfo('Development: HTTPS enabled for WebRTC support');
  } else if (config.nodeEnv === 'production') {
    loggingService.logInfo('Production: HTTP mode (SSL handled by Railway)');
  } else {
    loggingService.logInfo('Development: HTTP mode');
  }
}); 