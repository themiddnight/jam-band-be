import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';

// Import our modular components
import { corsMiddleware } from './middleware/cors';
import { createSocketServer } from './config/socket';
import { createRoutes } from './routes';
import { RoomService } from './services/RoomService';
import { RoomHandlers } from './handlers/RoomHandlers';
import { SocketManager } from './socket/socketManager';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = createSocketServer(server);

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

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 