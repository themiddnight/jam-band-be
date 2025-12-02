import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware';
import { UserType } from '../../domain/models/User';

export const enforceGuestLimitations = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.userType === UserType.GUEST) {
    res.status(403).json({
      error: 'Guest users cannot perform this action',
      message: 'Please sign up to access this feature',
    });
    return;
  }

  next();
};

export const requireRegistered = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (req.user.userType === UserType.GUEST) {
    res.status(403).json({
      error: 'Registration required',
      message: 'Please sign up to access this feature',
    });
    return;
  }

  next();
};

