import { Request, Response, NextFunction } from 'express';

/**
 * Extended Request interface to include user information
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username?: string;
    email?: string;
    roles?: string[];
  };
}

/**
 * Basic authentication middleware
 * For now, this is a placeholder that allows all requests through
 * In a real application, you would validate JWT tokens, API keys, etc.
 */
export const authenticateUser = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // For development/demo purposes, we'll create a mock user
    // In production, you would validate actual authentication tokens
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      // For now, allow requests without auth for development
      req.user = {
        id: 'demo-user-' + Math.random().toString(36).substr(2, 9),
        username: 'demo-user',
        email: 'demo@example.com',
        roles: ['user']
      };
      return next();
    }
    
    // Basic token validation (replace with real JWT validation)
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Mock token validation - replace with real implementation
      if (token === 'demo-token' || token.length > 0) {
        req.user = {
          id: 'authenticated-user-' + Math.random().toString(36).substr(2, 9),
          username: 'authenticated-user',
          email: 'user@example.com',
          roles: ['user']
        };
        return next();
      }
    }
    
    // If we reach here, authentication failed
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide a valid authentication token'
    });
    
  } catch (error) {
    console.error('Authentication middleware error:', error);
    res.status(500).json({
      error: 'Internal authentication error'
    });
  }
};

/**
 * Role-based authorization middleware
 */
export const requireRole = (requiredRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }
    
    const userRoles = req.user.roles || [];
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));
    
    if (!hasRequiredRole) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Required roles: ${requiredRoles.join(', ')}`
      });
    }
    
    next();
  };
};

/**
 * Optional authentication middleware
 * Adds user info if available but doesn't require it
 */
export const optionalAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    // Mock token validation
    if (token.length > 0) {
      req.user = {
        id: 'optional-user-' + Math.random().toString(36).substr(2, 9),
        username: 'optional-user',
        email: 'optional@example.com',
        roles: ['user']
      };
    }
  }
  
  next();
};