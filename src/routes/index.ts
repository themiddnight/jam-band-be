import { Router } from 'express';
import { RoomHandlers } from '../handlers/RoomHandlers';

export const createRoutes = (roomHandlers: RoomHandlers): Router => {
  const router = Router();

  // Health check endpoint
  router.get('/health', (req, res) => roomHandlers.getHealthCheck(req, res));

  // Get room list
  router.get('/api/rooms', (req, res) => roomHandlers.getRoomList(req, res));

  return router;
}; 