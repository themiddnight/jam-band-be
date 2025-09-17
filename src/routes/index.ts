import { Router } from 'express';
import { RoomHandlers } from '../handlers/RoomHandlers';
import { RoomLifecycleHandler } from '../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import { validateData, leaveRoomHttpSchema, createRoomSchema } from '../validation/schemas';
import { config } from '../config/environment';

export const createRoutes = (roomHandlers: RoomHandlers, roomLifecycleHandler: RoomLifecycleHandler): Router => {
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

  // Create room endpoint with validation
  router.post('/rooms', (req, res) => {
    // Validate request body
    const validationResult = validateData(createRoomSchema, req.body);
    if (validationResult.error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        details: validationResult.error
      });
    }

    // Update request body with validated data
    if (validationResult.value) {
      req.body = validationResult.value;
    }

    return roomLifecycleHandler.handleCreateRoomHttp(req, res);
  });

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

    return roomLifecycleHandler.handleLeaveRoomHttp(req, res);
  });

  // Update room settings endpoint with validation
  router.put('/rooms/:roomId/settings', (req, res) => {
    return roomLifecycleHandler.handleUpdateRoomSettingsHttp(req, res);
  });

  return router;
}; 