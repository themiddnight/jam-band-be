import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { loggingService } from '../services/LoggingService';
import { tokenService } from '../domains/auth/domain/services/TokenService';
import { UserRepository } from '../domains/auth/infrastructure/repositories/UserRepository';

export const createSocketServer = (httpServer: HttpServer): Server => {
  // Clean up the frontend URL by removing trailing slash
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') || "https://jam-band-fe.vercel.app";
  
  loggingService.logInfo('Socket.IO CORS configuration', {
    origin: frontendUrl,
    nodeEnv: process.env.NODE_ENV
  });
  
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? frontendUrl
        : "*", // Allow all origins in development
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Add JWT authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      
      if (!token) {
        // Allow guest connections (no token)
        socket.data.user = null;
        return next();
      }

      const payload = tokenService.verifyToken(token);
      const userRepository = new UserRepository();
      const user = await userRepository.findById(payload.userId);

      if (user) {
        socket.data.user = {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
        };
      } else {
        socket.data.user = null;
      }

      next();
    } catch {
      // Allow connection even if token is invalid (guest mode)
      socket.data.user = null;
      next();
    }
  });

  return io;
}; 