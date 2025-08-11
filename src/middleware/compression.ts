import compression from 'compression';
import { Request, Response } from 'express';

export const compressionMiddleware = compression({
  filter: (req: Request, res: Response) => {
    // Don't compress responses with this request header
    if (req.headers['x-no-compression']) {
      return false;
    }
    
    // Use compression for responses larger than 1kb
    return compression.filter(req, res);
  },
  level: 6, // Balanced compression level
  threshold: 1024, // Only compress responses larger than 1kb
}); 