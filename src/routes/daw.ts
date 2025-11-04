import { Router, Request, Response } from 'express';
import type { CreateProjectRequest } from '../types/daw';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { AudioFileStorageService } from '../services/AudioFileStorageService';
import { InstantSyncService } from '../services/InstantSyncService';
import { RealTimeChangeService } from '../services/RealTimeChangeService';
import { ChangeStreamingService } from '../services/ChangeStreamingService';

import { loggingService } from '../services/LoggingService';
import Joi from 'joi';
import midiRegionsRoutes from './midiRegions';
import timelineStateRoutes from './timelineState';

const router = Router();

// Initialize services
const projectStateManager = ProjectStateManager.getInstance();
const audioFileStorageService = AudioFileStorageService.getInstance();
const instantSyncService = InstantSyncService.getInstance();
const realTimeChangeService = RealTimeChangeService.getInstance();
const changeStreamingService = ChangeStreamingService.getInstance();


// Note: Audio file upload will be implemented with proper multer setup later

// ============================================================================
// Validation Schemas
// ============================================================================

const createProjectSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  roomId: Joi.string().required(),
  tempo: Joi.number().min(60).max(200).optional(),
  timeSignature: Joi.object({
    numerator: Joi.number().min(1).max(16).required(),
    denominator: Joi.number().valid(2, 4, 8, 16).required(),
  }).optional(),
  length: Joi.number().min(1).max(1000).optional(),
  settings: Joi.object().optional(),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  tempo: Joi.number().min(60).max(200).optional(),
  timeSignatureNumerator: Joi.number().min(1).max(16).optional(),
  timeSignatureDenominator: Joi.number().valid(2, 4, 8, 16).optional(),
  length: Joi.number().min(1).max(1000).optional(),
  settings: Joi.object().optional(),
  clickTrackSettings: Joi.object().optional(),
});

const createTrackSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid('midi', 'audio').required(),
  color: Joi.string().optional(),
  instrumentId: Joi.string().optional(),
  settings: Joi.object().optional(),
});

const updateTrackSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  color: Joi.string().optional(),
  order: Joi.number().min(0).optional(),
  height: Joi.number().min(32).max(200).optional(),
  muted: Joi.boolean().optional(),
  soloed: Joi.boolean().optional(),
  volume: Joi.number().min(0).max(2).optional(),
  pan: Joi.number().min(-1).max(1).optional(),
  effectChainId: Joi.string().optional(),
  instrumentId: Joi.string().optional(),
  midiChannel: Joi.number().min(0).max(15).optional(),
  inputSource: Joi.string().optional(),
  settings: Joi.object().optional(),
});

const createRegionSchema = Joi.object({
  trackId: Joi.string().required(),
  type: Joi.string().valid('midi', 'audio').required(),
  startTime: Joi.number().min(0).required(),
  duration: Joi.number().min(0.1).required(),
  name: Joi.string().optional(),
  notes: Joi.array().optional(),
  quantization: Joi.number().optional(),
  velocity: Joi.number().min(0).max(1).optional(),
  audioFileId: Joi.string().optional(),
  fadeIn: Joi.number().min(0).optional(),
  fadeOut: Joi.number().min(0).optional(),
  gain: Joi.number().min(0).max(2).optional(),
  pitch: Joi.number().min(-12).max(12).optional(),
  timeStretch: Joi.number().min(0.5).max(2).optional(),
  settings: Joi.object().optional(),
});

// ============================================================================
// Project Routes
// ============================================================================

// Get projects for a room
router.get('/rooms/:roomId/projects', async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params as { roomId: string };
    const projects = await projectStateManager.getProjectsByRoom(roomId);
    
    return res.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    loggingService.logError('Failed to get projects for room', { roomId: req.params.roomId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get projects',
    });
  }
});

// Create new project
router.post('/rooms/:roomId/projects', async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params as { roomId: string };
    const userId = req.headers['x-user-id'] as string; // Assuming user ID is in headers
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const { error, value } = createProjectSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const projectData: CreateProjectRequest = { ...value, roomId };
    const project = await projectStateManager.createProject(roomId, userId, projectData);
    
    return res.status(201).json({
      success: true,
      data: project,
    });
  } catch (error) {
    loggingService.logError('Failed to create project', { roomId: req.params.roomId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to create project',
    });
  }
});

// Get project details
router.get('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const project = await projectStateManager.getProject(projectId);
    
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }
    
    return res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    loggingService.logError('Failed to get project', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get project',
    });
  }
});

// Get complete project state
router.get('/projects/:projectId/complete-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const state = await projectStateManager.getCompleteProjectState(projectId);
    
    if (!state) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }
    
    return res.json({
      success: true,
      data: state,
    });
  } catch (error) {
    loggingService.logError('Failed to get complete project state', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get project state',
    });
  }
});

// Update project
router.put('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const { error, value } = updateProjectSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const project = await projectStateManager.updateProject(projectId, userId, value);
    
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }
    
    return res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    loggingService.logError('Failed to update project', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to update project',
    });
  }
});

// Delete project
router.delete('/projects/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const success = await projectStateManager.deleteProject(projectId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }
    
    return res.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    loggingService.logError('Failed to delete project', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete project',
    });
  }
});

// ============================================================================
// Track Routes
// ============================================================================

// Get tracks for a project
router.get('/projects/:projectId/tracks', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const tracks = await projectStateManager.getTracksByProject(projectId);
    
    return res.json({
      success: true,
      data: tracks,
    });
  } catch (error) {
    loggingService.logError('Failed to get tracks', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get tracks',
    });
  }
});

// Create new track
router.post('/projects/:projectId/tracks', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const { error, value } = createTrackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const track = await projectStateManager.createTrack(projectId, userId, value);
    
    return res.status(201).json({
      success: true,
      data: track,
    });
  } catch (error) {
    loggingService.logError('Failed to create track', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to create track',
    });
  }
});

// Update track
router.put('/tracks/:trackId', async (req: Request, res: Response) => {
  try {
    const { trackId } = req.params as { trackId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const { error, value } = updateTrackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const track = await projectStateManager.updateTrack(trackId, userId, value);
    
    if (!track) {
      return res.status(404).json({
        success: false,
        error: 'Track not found',
      });
    }
    
    return res.json({
      success: true,
      data: track,
    });
  } catch (error) {
    loggingService.logError('Failed to update track', { trackId: req.params.trackId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to update track',
    });
  }
});

// Delete track
router.delete('/tracks/:trackId', async (req: Request, res: Response) => {
  try {
    const { trackId } = req.params as { trackId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const success = await projectStateManager.deleteTrack(trackId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Track not found',
      });
    }
    
    return res.json({
      success: true,
      message: 'Track deleted successfully',
    });
  } catch (error) {
    loggingService.logError('Failed to delete track', { trackId: req.params.trackId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete track',
    });
  }
});

// ============================================================================
// Region Routes
// ============================================================================

// Create new region
router.post('/projects/:projectId/regions', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const { error, value } = createRegionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const region = await projectStateManager.createRegion(projectId, userId, value);
    
    return res.status(201).json({
      success: true,
      data: region,
    });
  } catch (error) {
    loggingService.logError('Failed to create region', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to create region',
    });
  }
});

// Update region
router.put('/regions/:regionId', async (req: Request, res: Response) => {
  try {
    const { regionId } = req.params as { regionId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const region = await projectStateManager.updateRegion(regionId, userId, req.body);
    
    if (!region) {
      return res.status(404).json({
        success: false,
        error: 'Region not found',
      });
    }
    
    return res.json({
      success: true,
      data: region,
    });
  } catch (error) {
    loggingService.logError('Failed to update region', { regionId: req.params.regionId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to update region',
    });
  }
});

// Delete region
router.delete('/regions/:regionId', async (req: Request, res: Response) => {
  try {
    const { regionId } = req.params as { regionId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const success = await projectStateManager.deleteRegion(regionId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Region not found',
      });
    }
    
    return res.json({
      success: true,
      message: 'Region deleted successfully',
    });
  } catch (error) {
    loggingService.logError('Failed to delete region', { regionId: req.params.regionId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to delete region',
    });
  }
});

// ============================================================================
// Audio File Routes
// ============================================================================

// Upload audio file - redirect to dedicated audio files route
router.post('/projects/:projectId/audio-files', async (req: Request, res: Response) => {
  res.status(301).json({
    success: false,
    error: 'Audio file upload has moved to /api/audio-files/upload',
    redirectTo: '/api/audio-files/upload',
  });
});

// Get audio files for a project
router.get('/projects/:projectId/audio-files', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const audioFiles = await audioFileStorageService.getAudioFilesByProject(projectId);
    
    return res.json({
      success: true,
      data: audioFiles,
    });
  } catch (error) {
    loggingService.logError('Failed to get audio files', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get audio files',
    });
  }
});

// Download audio file
router.get('/audio-files/:audioFileId/download', async (req: Request, res: Response) => {
  try {
    const { audioFileId } = req.params as { audioFileId: string };
    
    const [audioFile, fileBuffer] = await Promise.all([
      audioFileStorageService.getAudioFileMetadata(audioFileId),
      audioFileStorageService.getAudioFile(audioFileId),
    ]);
    
    if (!audioFile || !fileBuffer) {
      return res.status(404).json({
        success: false,
        error: 'Audio file not found',
      });
    }
    
    res.setHeader('Content-Type', audioFile.format);
    res.setHeader('Content-Disposition', `attachment; filename="${audioFile.originalName}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    
    return res.send(fileBuffer);
  } catch (error) {
    loggingService.logError('Failed to download audio file', { audioFileId: req.params.audioFileId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to download audio file',
    });
  }
});

// ============================================================================
// Change Tracking Routes
// ============================================================================

// Get recent changes for a project
router.get('/projects/:projectId/changes', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const limit = parseInt(req.query.limit as string) || 50;
    
    const changes = await projectStateManager.getRecentChanges(projectId, limit);
    
    return res.json({
      success: true,
      data: changes,
    });
  } catch (error) {
    loggingService.logError('Failed to get project changes', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get project changes',
    });
  }
});

// Get changes since timestamp
router.get('/projects/:projectId/changes/since/:timestamp', async (req: Request, res: Response) => {
  try {
    const { projectId, timestamp } = req.params as { projectId: string; timestamp: string };
    const since = new Date(parseInt(timestamp));
    
    const changes = await projectStateManager.getChangesSince(projectId, since);
    
    return res.json({
      success: true,
      data: changes,
    });
  } catch (error) {
    loggingService.logError('Failed to get changes since timestamp', { 
      projectId: req.params.projectId, 
      timestamp: req.params.timestamp, 
      error 
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to get changes',
    });
  }
});

// ============================================================================
// Instant Sync Routes
// ============================================================================

// Trigger instant sync for a user joining a room
router.post('/rooms/:roomId/sync-user', async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params as { roomId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    // Start instant sync process
    await instantSyncService.onUserJoinRoom(userId, roomId);
    
    return res.json({
      success: true,
      message: 'Instant sync initiated',
    });
  } catch (error) {
    loggingService.logError('Failed to initiate instant sync', { roomId: req.params.roomId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate instant sync',
    });
  }
});

// Verify user state consistency
router.post('/projects/:projectId/verify-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const clientState = req.body;
    const result = await instantSyncService.verifyStateConsistency(userId, projectId, clientState);
    
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    loggingService.logError('Failed to verify state consistency', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to verify state consistency',
    });
  }
});

// Reconcile user state
router.post('/projects/:projectId/reconcile-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const clientState = req.body;
    await instantSyncService.reconcileUserState(userId, projectId, clientState);
    
    return res.json({
      success: true,
      message: 'State reconciliation initiated',
    });
  } catch (error) {
    loggingService.logError('Failed to reconcile user state', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to reconcile user state',
    });
  }
});

// Load project progressively
router.post('/projects/:projectId/load-progressive', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const options = req.body;
    await instantSyncService.loadProjectProgressively(userId, projectId, options);
    
    return res.json({
      success: true,
      message: 'Progressive loading initiated',
    });
  } catch (error) {
    loggingService.logError('Failed to initiate progressive loading', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate progressive loading',
    });
  }
});

// Warm up project cache for a room
router.post('/rooms/:roomId/warmup-cache', async (req: Request, res: Response) => {
  try {
    const { roomId } = req.params as { roomId: string };
    
    await instantSyncService.warmupProjectCache(roomId);
    
    return res.json({
      success: true,
      message: 'Cache warmup initiated',
    });
  } catch (error) {
    loggingService.logError('Failed to warm up cache', { roomId: req.params.roomId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to warm up cache',
    });
  }
});

// Invalidate project cache
router.delete('/projects/:projectId/cache', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    
    instantSyncService.invalidateProjectCache(projectId);
    
    return res.json({
      success: true,
      message: 'Project cache invalidated',
    });
  } catch (error) {
    loggingService.logError('Failed to invalidate project cache', { projectId: req.params.projectId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to invalidate project cache',
    });
  }
});

// ============================================================================
// Statistics Routes
// ============================================================================

// Get storage statistics
router.get('/stats/storage', async (req: Request, res: Response) => {
  try {
    const [dbStats, storageStats] = await Promise.all([
      projectStateManager.getStats(),
      audioFileStorageService.getStorageStats(),
    ]);
    
    return res.json({
      success: true,
      data: {
        database: dbStats,
        storage: storageStats,
      },
    });
  } catch (error) {
    loggingService.logError('Failed to get storage statistics', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get statistics',
    });
  }
});

// Get instant sync performance statistics
router.get('/stats/instant-sync', async (req: Request, res: Response) => {
  try {
    const stats = await instantSyncService.getPerformanceStats();
    
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    loggingService.logError('Failed to get instant sync statistics', { error });
    return res.status(500).json({
      success: false,
      error: 'Failed to get instant sync statistics',
    });
  }
});

// Reset instant sync performance statistics
router.delete('/stats/instant-sync', async (req: Request, res: Response) => {
  try {
    await instantSyncService.resetPerformanceStats();
    
    return res.json({
      success: true,
      message: 'Instant sync statistics reset',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to reset instant sync statistics')
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to reset instant sync statistics',
    });
  }
});

// ============================================================================
// Real-Time Change Persistence Routes
// ============================================================================

// Force save pending changes for a project
router.post('/projects/:projectId/force-save', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    await realTimeChangeService.forceSave(projectId);
    
    return res.json({
      success: true,
      message: 'Project changes saved successfully',
      timestamp: new Date(),
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to force save project'),
      { projectId: req.params.projectId }
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to save project changes',
    });
  }
});

// Get change history for a project
router.get('/projects/:projectId/change-history', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const limit = parseInt(req.query.limit as string) || 100;
    
    const history = await realTimeChangeService.getChangeHistory(projectId, limit);
    
    return res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get change history'),
      { projectId: req.params.projectId }
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to get change history',
    });
  }
});

// Rollback project to a specific change
router.post('/projects/:projectId/rollback/:changeId', async (req: Request, res: Response) => {
  try {
    const { projectId, changeId } = req.params as { projectId: string; changeId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const success = await realTimeChangeService.rollbackToChange(projectId, changeId, userId);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Change not found or rollback failed',
      });
    }
    
    return res.json({
      success: true,
      message: 'Project rolled back successfully',
      timestamp: new Date(),
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to rollback project'),
      { projectId: req.params.projectId, changeId: req.params.changeId }
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to rollback project',
    });
  }
});

// Queue a manual change for persistence
router.post('/projects/:projectId/queue-change', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    const { changeType, data, previousData } = req.body;
    
    if (!changeType || !data) {
      return res.status(400).json({
        success: false,
        error: 'Change type and data are required',
      });
    }

    await realTimeChangeService.queueChange(projectId, userId, changeType, data, previousData);
    
    return res.json({
      success: true,
      message: 'Change queued for persistence',
      timestamp: new Date(),
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to queue change'),
      { projectId: req.params.projectId }
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to queue change',
    });
  }
});

// Get real-time change service statistics
router.get('/stats/real-time-changes', async (req: Request, res: Response) => {
  try {
    const stats = realTimeChangeService.getStats();
    
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get real-time change statistics')
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to get real-time change statistics',
    });
  }
});

// Get change streaming connection statistics
router.get('/stats/change-streaming', async (req: Request, res: Response) => {
  try {
    const stats = changeStreamingService.getConnectionStats();
    
    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get change streaming statistics')
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to get change streaming statistics',
    });
  }
});

// Send system message to user
router.post('/users/:userId/system-message', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params as { userId: string };
    const { type, data } = req.body;
    
    if (!type || !data) {
      return res.status(400).json({
        success: false,
        error: 'Message type and data are required',
      });
    }

    changeStreamingService.sendUserMessage(userId, { type, data });
    
    return res.json({
      success: true,
      message: 'System message sent',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to send system message'),
      { userId: req.params.userId }
    );
    return res.status(500).json({
      success: false,
      error: 'Failed to send system message',
    });
  }
});

// ============================================================================
// Sub-route Integration
// ============================================================================

// MIDI Regions routes for piano roll persistence
router.use('/', midiRegionsRoutes);

// Timeline State routes for timeline persistence
router.use('/', timelineStateRoutes);

// Transport State routes for transport control persistence
import transportStateRoutes from './transportState';
router.use('/', transportStateRoutes);

// Mixer State routes for mixer persistence
import mixerStateRoutes from './mixerState';
router.use('/', mixerStateRoutes);

// Audio Recording Sync routes for integrated recording
import audioRecordingSyncRoutes from './audioRecordingSync';
router.use('/recording', audioRecordingSyncRoutes);

export default router;