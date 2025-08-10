import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import fs from 'fs';
import path from 'path';

// Import our modular components
import { config } from './config/environment';
import { corsMiddleware } from './middleware/cors';
import { createSocketServer } from './config/socket';
import { createRoutes } from './routes';
import { RoomService } from './services/RoomService';
import { RoomHandlers } from './handlers/RoomHandlers';
import { SocketManager } from './socket/socketManager';

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
      console.log('🔒 Development: Using HTTPS with self-signed certificates');
    } else {
      throw new Error('SSL certificates not found');
    }
  } catch (error) {
    console.warn('⚠️  SSL certificates not found, falling back to HTTP');
    console.warn('⚠️  WebRTC may not work properly in development');
    server = createServer(app);
  }
} else {
  // Production mode or HTTP only - use HTTP (Railway will handle SSL termination)
  server = createServer(app);
  if (config.nodeEnv === 'production') {
    console.log('🌐 Production: Using HTTP (SSL handled by Railway)');
  } else {
    console.log('🔓 Development: Using HTTP mode');
  }
}

io = createSocketServer(server);

// Initialize services
const roomService = new RoomService();
const roomHandlers = new RoomHandlers(roomService, io);
const socketManager = new SocketManager(io, roomHandlers);

// Middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json());

// Routes
app.use('/api', createRoutes(roomHandlers));

// Initialize socket manager
socketManager.initialize();

// Periodic cleanup task for expired grace time entries
setInterval(() => {
  roomService.cleanupExpiredGraceTime();
}, 30000); // Run every 30 seconds

server.listen(config.port, () => {
  const protocol = config.nodeEnv === 'development' && config.ssl.enabled ? 'https' : 'http';
  console.log(`🚀 Server running on port ${config.port} in ${config.nodeEnv} mode`);
  console.log(`📡 API available at: ${protocol}://localhost:${config.port}/api`);
  console.log(`🔌 Socket.IO available at: ${protocol}://localhost:${config.port}`);
  
  if (config.nodeEnv === 'development' && config.ssl.enabled) {
    console.log('🔒 Development: HTTPS enabled for WebRTC support');
  } else if (config.nodeEnv === 'production') {
    console.log('🌐 Production: HTTP mode (SSL handled by Railway)');
  } else {
    console.log('🔓 Development: HTTP mode');
  }
}); 