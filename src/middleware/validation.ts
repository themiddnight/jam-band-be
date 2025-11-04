import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Validation middleware for request validation using Zod schemas
 */
export const validateRequest = <T extends z.ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    try {
      // Validate request body
      const result = schema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: result.error.issues.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        });
      }
      
      // Replace req.body with validated data
      req.body = result.data as unknown as typeof req.body;
      return next();
    } catch (error) {
      console.error('Validation middleware error:', error);
      return res.status(500).json({
        error: 'Internal validation error'
      });
    }
  };
};

/**
 * Validate query parameters
 */
export const validateQuery = <T extends z.ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    try {
      const result = schema.safeParse(req.query);
      
      if (!result.success) {
        return res.status(400).json({
          error: 'Query validation failed',
          details: result.error.issues.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        });
      }
      
      req.query = result.data as unknown as typeof req.query;
      return next();
    } catch (error) {
      console.error('Query validation middleware error:', error);
      return res.status(500).json({
        error: 'Internal validation error'
      });
    }
  };
};

/**
 * Validate route parameters
 */
export const validateParams = <T extends z.ZodTypeAny>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction): Response | void => {
    try {
      const result = schema.safeParse(req.params);
      
      if (!result.success) {
        return res.status(400).json({
          error: 'Parameter validation failed',
          details: result.error.issues.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        });
      }
      
      req.params = result.data as unknown as typeof req.params;
      return next();
    } catch (error) {
      console.error('Parameter validation middleware error:', error);
      return res.status(500).json({
        error: 'Internal validation error'
      });
    }
  };
};