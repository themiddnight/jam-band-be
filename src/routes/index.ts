import { Router } from 'express';
import { RoomHandlers } from '../handlers/RoomHandlers';
import { validateData, leaveRoomHttpSchema } from '../validation/schemas';
import { config } from '../config/environment';

export const createRoutes = (roomHandlers: RoomHandlers): Router => {
  const router = Router();

  // Simple health check endpoint (no dependencies)
  router.get('/health/simple', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      frontendUrl: config.cors.frontendUrl,
      corsStrictMode: config.cors.strictMode
    });
  });

  // Health check endpoint
  router.get('/health', (req, res) => roomHandlers.getHealthCheck(req, res));

  // Get room list
  router.get('/rooms', (req, res) => roomHandlers.getRoomList(req, res));

  // Leave room endpoint with validation
  router.post('/rooms/:roomId/leave', (req, res) => {
    // Validate request body
    const validationResult = validateData(leaveRoomHttpSchema, req.body);
    if (validationResult.error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
    }

    // Add roomId from params to validated body
    if (validationResult.value) {
      req.body = {
        ...validationResult.value,
        roomId: req.params.roomId
      };
    }

    return roomHandlers.handleLeaveRoomHttp(req, res);
  });

  return router;
}; 