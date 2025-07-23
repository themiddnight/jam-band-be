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

const PORT = process.env.PORT || 3001;

// Initialize services
const roomService = new RoomService();
const roomHandlers = new RoomHandlers(roomService, io);
const socketManager = new SocketManager(io, roomHandlers);

// Middleware
app.use(helmet());
app.use(corsMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', createRoutes(roomHandlers));

// Initialize socket manager
socketManager.initialize();

// Start server
server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

export default app; 