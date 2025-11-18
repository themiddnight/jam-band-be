import { Router } from 'express';
import { RoomHandlers } from '../handlers/RoomHandlers';
import { RoomLifecycleHandler } from '../domains/room-management/infrastructure/handlers/RoomLifecycleHandler';
import { validateData, leaveRoomHttpSchema, createRoomSchema } from '../validation/schemas';
import { config } from '../config/environment';
import multer from 'multer';
import os from 'os';
import { AudioRegionController } from '../domains/arrange-room/infrastructure/controllers/AudioRegionController';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, os.tmpdir());
    },
    filename: (_req, file, cb) => {
      const sanitized = file.originalname.replace(/\s+/g, '_');
      cb(null, `${Date.now()}-${sanitized}`);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

export const createRoutes = (
  roomHandlers: RoomHandlers,
  roomLifecycleHandler: RoomLifecycleHandler,
  audioRegionController: AudioRegionController
): Router => {
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

  // Audio recording upload endpoint
  router.post(
    '/rooms/:roomId/audio/regions',
    upload.single('audio'),
    (req, res) => audioRegionController.uploadRegionAudio(req, res)
  );

  // Audio streaming endpoint
  router.get('/rooms/:roomId/audio/regions/:regionId', (req, res) =>
    audioRegionController.streamRegionAudio(req, res)
  );

  return router;
};