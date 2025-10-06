import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { loggingService } from '../services/LoggingService';

export const createSocketServer = (httpServer: HttpServer): Server => {
  // Clean up the frontend URL by removing trailing slash
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') || "https://jam-band-fe.vercel.app";
  
  loggingService.logInfo('Socket.IO CORS configuration', {
    origin: frontendUrl,
    nodeEnv: process.env.NODE_ENV
  });
  
  return new Server(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? frontendUrl
        : "*", // Allow all origins in development
      methods: ["GET", "POST"],
      credentials: true
    }
  });
}; 