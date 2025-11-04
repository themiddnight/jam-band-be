import { Router } from 'express';
import { TimelineStateManager } from '../services/TimelineStateManager';
import { validateRequest } from '../middleware/validation';
import { authenticateUser } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// Validation schemas
const TransportStateSchema = z.object({
  isPlaying: z.boolean(),
  isPaused: z.boolean(),
  isRecording: z.boolean(),
  position: z.number(),
  loopEnabled: z.boolean(),
  loopStart: z.number(),
  loopEnd: z.number(),
  mode: z.enum(['private', 'public']),
  masterUserId: z.string().optional(),
  tempo: z.number().min(60).max(200).optional(),
  timeSignature: z.object({
    numerator: z.number().min(1).max(16),
    denominator: z.number().min(1).max(16),
  }).optional(),
});

const PrivateTransportStateSchema = z.object({
  userId: z.string(),
  isPlaying: z.boolean(),
  isPaused: z.boolean(),
  position: z.number(),
  loopEnabled: z.boolean(),
  loopStart: z.number(),
  loopEnd: z.number(),
  soloMode: z.boolean(),
  soloTrackIds: z.array(z.string()),
  playbackRate: z.number().min(0.25).max(2.0),
  lastActivity: z.string().datetime(),
});

const TransportChangeSchema = z.object({
  id: z.string(),
  type: z.enum([
    'transport_play',
    'transport_pause',
    'transport_stop',
    'transport_seek',
    'transport_loop_toggle',
    'transport_tempo_change',
    'transport_time_signature_change',
    'transport_mode_change',
    'transport_master_change',
    'transport_master_request',
    'transport_master_release',
    'transport_master_handoff'
  ]),
  data: z.any(),
  timestamp: z.string().datetime(),
  userId: z.string(),
  masterUserId: z.string().optional(),
  syncData: z.any().optional(),
});

const SaveTransportStateSchema = z.object({
  transport: TransportStateSchema,
  privateStates: z.record(z.string(), PrivateTransportStateSchema).optional(),
  changes: z.array(TransportChangeSchema),
  timestamp: z.string().datetime(),
});

/**
 * GET /api/projects/:projectId/transport-state
 * Get current transport state for a project
 */
router.get(
  '/projects/:projectId/transport-state',
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get timeline state manager instance
      const stateManager = TimelineStateManager.getInstance();
      
      // Get current transport state
      const transportState = await stateManager.getTransportState(projectId);
      
      if (!transportState) {
        return res.status(404).json({ error: 'Transport state not found' });
      }

      // Get private transport states for all users
      const privateStates = await stateManager.getPrivateTransportStates(projectId);

      res.json({
        transport: transportState,
        privateStates,
        lastSaved: transportState.lastSaved || new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to get transport state:', error);
      res.status(500).json({ 
        error: 'Failed to get transport state',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * PUT /api/projects/:projectId/transport-state
 * Save transport state for a project
 */
router.put(
  '/projects/:projectId/transport-state',
  authenticateUser,
  validateRequest(SaveTransportStateSchema),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;
      const { transport, privateStates, changes, timestamp } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get timeline state manager instance
      const stateManager = TimelineStateManager.getInstance();

      // Save transport state
      await stateManager.saveTransportState(projectId, {
        ...transport,
        lastSaved: new Date(timestamp),
        version: (transport.version || 0) + 1,
      });

      // Save private transport states
      if (privateStates) {
        for (const [stateUserId, privateState] of Object.entries(privateStates)) {
          await stateManager.savePrivateTransportState(projectId, stateUserId, privateState);
        }
      }

      // Process and save changes for collaboration
      if (changes && changes.length > 0) {
        await stateManager.processTransportChanges(projectId, userId, changes);
      }

      // Broadcast changes to other users in the room
      if (changes && changes.length > 0) {
        await stateManager.broadcastTransportChanges(projectId, userId, changes);
      }

      res.json({
        success: true,
        savedAt: new Date().toISOString(),
        changesProcessed: changes?.length || 0,
      });
    } catch (error) {
      console.error('Failed to save transport state:', error);
      res.status(500).json({ 
        error: 'Failed to save transport state',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /api/projects/:projectId/transport-state/sync
 * Force synchronization of transport state across all users
 */
router.post(
  '/projects/:projectId/transport-state/sync',
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get timeline state manager instance
      const stateManager = TimelineStateManager.getInstance();

      // Force sync transport state
      const syncResult = await stateManager.forceSyncTransportState(projectId, userId);

      res.json({
        success: true,
        syncedAt: new Date().toISOString(),
        usersNotified: syncResult.usersNotified,
        stateVersion: syncResult.stateVersion,
      });
    } catch (error) {
      console.error('Failed to sync transport state:', error);
      res.status(500).json({ 
        error: 'Failed to sync transport state',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /api/projects/:projectId/transport-state/master-control
 * Handle master control requests and handoffs
 */
router.post(
  '/projects/:projectId/transport-state/master-control',
  authenticateUser,
  validateRequest(z.object({
    action: z.enum(['request', 'release', 'handoff']),
    targetUserId: z.string().optional(),
  })),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;
      const { action, targetUserId } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get timeline state manager instance
      const stateManager = TimelineStateManager.getInstance();

      let result;
      switch (action) {
        case 'request':
          result = await stateManager.requestMasterControl(projectId, userId);
          break;
        case 'release':
          result = await stateManager.releaseMasterControl(projectId, userId);
          break;
        case 'handoff':
          if (!targetUserId) {
            return res.status(400).json({ error: 'Target user ID required for handoff' });
          }
          result = await stateManager.handoffMasterControl(projectId, userId, targetUserId);
          break;
        default:
          return res.status(400).json({ error: 'Invalid action' });
      }

      res.json({
        success: true,
        action,
        masterUserId: result.masterUserId,
        changedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to handle master control:', error);
      res.status(500).json({ 
        error: 'Failed to handle master control',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * GET /api/projects/:projectId/transport-state/history
 * Get transport state change history
 */
router.get(
  '/projects/:projectId/transport-state/history',
  authenticateUser,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user?.id;
      const { limit = 50, offset = 0, since } = req.query;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get timeline state manager instance
      const stateManager = TimelineStateManager.getInstance();

      // Get transport change history
      const history = await stateManager.getTransportChangeHistory(projectId, {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        since: since ? new Date(since as string) : undefined,
      });

      res.json({
        changes: history.changes,
        total: history.total,
        hasMore: history.hasMore,
      });
    } catch (error) {
      console.error('Failed to get transport history:', error);
      res.status(500).json({ 
        error: 'Failed to get transport history',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;