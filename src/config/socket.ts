import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

export const createSocketServer = (httpServer: HttpServer): Server => {
  return new Server(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL || "http://localhost:5173"
        : "*", // Allow all origins in development
      methods: ["GET", "POST"]
    }
  });
}; 