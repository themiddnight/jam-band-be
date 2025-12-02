import { Request, Response, NextFunction } from 'express';
import { tokenService } from '../../domain/services/TokenService';
import { UserRepository } from '../repositories/UserRepository';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string | null;
    username: string | null;
    userType: string;
  } | undefined;
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const payload = tokenService.verifyToken(token);
    const userRepository = new UserRepository();
    const user = await userRepository.findById(payload.userId);

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      userType: user.userType,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const payload = tokenService.verifyToken(token);
      const userRepository = new UserRepository();
      const user = await userRepository.findById(payload.userId);

      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
        };
      }
    }

    next();
  } catch {
    // Continue without authentication
    next();
  }
};

