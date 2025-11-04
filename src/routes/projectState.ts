import { Router } from 'express';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { loggingService } from '../services/LoggingService';
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateTrackRequest,
  UpdateTrackRequest,
  CreateRegionRequest,
  UpdateRegionRequest,
} from '../types/daw';

const router = Router();
const projectStateManager = ProjectStateManager.getInstance();

// ============================================================================
// Project Operations
// ============================================================================

/**
 * GET /api/projects/:projectId
 * Get project details
 */
router.get('/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const project = await projectStateManager.getProject(projectId);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.json(project);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get project'), {
      projectId: req.params.projectId,
    });
    return res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * GET /api/projects/:projectId/complete-state
 * Get complete project state for new users
 */
router.get('/projects/:projectId/complete-state', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const completeState = await projectStateManager.getCompleteProjectState(projectId);
    
    if (!completeState) {
      return res.status(404).json({ error: 'Project state not found' });
    }

    return res.json(completeState);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get complete project state'), {
      projectId: req.params.projectId,
    });
    return res.status(500).json({ error: 'Failed to get project state' });
  }
});

/**
 * PUT /api/projects/:projectId
 * Update project settings
 */
router.put('/projects/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    const updates: UpdateProjectRequest = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const updatedProject = await projectStateManager.updateProject(projectId, userId, updates);
    
    if (!updatedProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.json(updatedProject);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to update project'), {
      projectId: req.params.projectId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * POST /api/projects/:projectId/force-save
 * Force immediate project save
 */
router.post('/projects/:projectId/force-save', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    await projectStateManager.forceSave(projectId, userId);
    return res.json({ success: true, timestamp: new Date() });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to force save project'), {
      projectId: req.params.projectId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to save project' });
  }
});

// ============================================================================
// Room Operations
// ============================================================================

/**
 * GET /api/rooms/:roomId/project
 * Get project for a room (if exists)
 */
router.get('/rooms/:roomId/project', async (req, res) => {
  try {
    const { roomId } = req.params as { roomId: string };
    const projects = await projectStateManager.getProjectsByRoom(roomId);
    
    // Return the most recent project for the room
    const latestProject = projects.length > 0 ? projects[0] : null;
    
    return res.json(latestProject);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get room project'), {
      roomId: req.params.roomId,
    });
    return res.status(500).json({ error: 'Failed to get room project' });
  }
});

/**
 * POST /api/rooms/:roomId/projects
 * Create new project in room
 */
router.post('/rooms/:roomId/projects', async (req, res) => {
  try {
    const { roomId } = req.params as { roomId: string };
    const userId = req.headers['x-user-id'] as string;
    const projectData: CreateProjectRequest = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const project = await projectStateManager.createProject(roomId, userId, projectData);
    return res.status(201).json(project);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to create project'), {
      roomId: req.params.roomId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to create project' });
  }
});

// ============================================================================
// Project History and Versioning
// ============================================================================

/**
 * GET /api/projects/:projectId/history
 * Get project change history
 */
router.get('/projects/:projectId/history', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const limit = parseInt(req.query.limit as string) || 50;
    
    const changes = await projectStateManager.getRecentChanges(projectId, limit);
    
    // Group changes by version/timestamp for better UI display
    const groupedHistory = changes.reduce((acc, change) => {
      const key = `${change.version}-${change.timestamp.toISOString().split('T')[0]}`;
      if (!acc[key]) {
        acc[key] = {
          id: key,
          version: change.version,
          timestamp: change.timestamp,
          userId: change.userId,
          changes: [],
          description: `Version ${change.version}`,
        };
      }
      acc[key].changes.push(change);
      return acc;
    }, {} as Record<string, any>);

    const history = Object.values(groupedHistory).sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );

    return res.json(history);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get project history'), {
      projectId: req.params.projectId,
    });
    return res.status(500).json({ error: 'Failed to get project history' });
  }
});

/**
 * GET /api/projects/:projectId/changes/since/:timestamp
 * Get changes since specific timestamp
 */
router.get('/projects/:projectId/changes/since/:timestamp', async (req, res) => {
  try {
    const { projectId, timestamp } = req.params as { projectId: string; timestamp: string };
    const since = new Date(timestamp);
    
    if (isNaN(since.getTime())) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    const changes = await projectStateManager.getChangesSince(projectId, since);
    return res.json(changes);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get changes since timestamp'), {
      projectId: req.params.projectId,
      timestamp: req.params.timestamp,
    });
    return res.status(500).json({ error: 'Failed to get changes' });
  }
});

/**
 * POST /api/projects/:projectId/revert/:version
 * Revert project to specific version
 */
router.post('/projects/:projectId/revert/:version', async (req, res) => {
  try {
    const { projectId: _projectId, version } = req.params as { projectId: string; version: string };
    const userId = req.headers['x-user-id'] as string;
    const targetVersion = parseInt(version);

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (isNaN(targetVersion)) {
      return res.status(400).json({ error: 'Invalid version number' });
    }

    // TODO: Implement version revert logic
    // This would involve:
    // 1. Getting the state at the target version
    // 2. Creating a new change that reverts to that state
    // 3. Broadcasting the revert to all connected users

    return res.json({ 
      success: true, 
      message: `Reverted to version ${targetVersion}`,
      timestamp: new Date(),
    });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to revert project version'), {
      projectId: req.params.projectId,
      version: req.params.version,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to revert project version' });
  }
});

// ============================================================================
// Conflict Resolution
// ============================================================================

/**
 * GET /api/projects/:projectId/conflicts
 * Get current project conflicts
 */
router.get('/projects/:projectId/conflicts', async (req, res) => {
  try {
    const { projectId: _projectId } = req.params as { projectId: string };
    
    // TODO: Implement conflict detection logic
    // This would involve:
    // 1. Checking for concurrent modifications
    // 2. Identifying conflicting changes
    // 3. Returning conflict details for resolution

    // For now, return empty conflicts
    return res.json([]);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get project conflicts'), {
      projectId: req.params.projectId,
    });
    return res.status(500).json({ error: 'Failed to get project conflicts' });
  }
});

/**
 * POST /api/projects/:projectId/resolve-conflicts
 * Resolve project conflicts
 */
router.post('/projects/:projectId/resolve-conflicts', async (req, res) => {
  try {
    const { projectId: _projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    const { resolvedChanges } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // TODO: Implement conflict resolution logic
    // This would involve:
    // 1. Validating the resolved changes
    // 2. Applying the resolution
    // 3. Broadcasting the resolution to all users

    return res.json({ 
      success: true, 
      resolvedCount: resolvedChanges?.length || 0,
      timestamp: new Date(),
    });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to resolve project conflicts'), {
      projectId: req.params.projectId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to resolve conflicts' });
  }
});

// ============================================================================
// Track Operations
// ============================================================================

/**
 * POST /api/projects/:projectId/tracks
 * Create new track
 */
router.post('/projects/:projectId/tracks', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    const trackData: CreateTrackRequest = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const track = await projectStateManager.createTrack(projectId, userId, trackData);
    return res.status(201).json(track);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to create track'), {
      projectId: req.params.projectId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to create track' });
  }
});

/**
 * PUT /api/tracks/:trackId
 * Update track
 */
router.put('/tracks/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params as { trackId: string };
    const userId = req.headers['x-user-id'] as string;
    const updates: UpdateTrackRequest = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const track = await projectStateManager.updateTrack(trackId, userId, updates);
    
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    return res.json(track);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to update track'), {
      trackId: req.params.trackId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to update track' });
  }
});

/**
 * DELETE /api/tracks/:trackId
 * Delete track
 */
router.delete('/tracks/:trackId', async (req, res) => {
  try {
    const { trackId } = req.params as { trackId: string };
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const success = await projectStateManager.deleteTrack(trackId, userId);
    
    if (!success) {
      return res.status(404).json({ error: 'Track not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to delete track'), {
      trackId: req.params.trackId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to delete track' });
  }
});

// ============================================================================
// Region Operations
// ============================================================================

/**
 * POST /api/projects/:projectId/regions
 * Create new region
 */
router.post('/projects/:projectId/regions', async (req, res) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    const regionData: CreateRegionRequest = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const region = await projectStateManager.createRegion(projectId, userId, regionData);
    return res.status(201).json(region);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to create region'), {
      projectId: req.params.projectId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to create region' });
  }
});

/**
 * PUT /api/regions/:regionId
 * Update region
 */
router.put('/regions/:regionId', async (req, res) => {
  try {
    const { regionId } = req.params as { regionId: string };
    const userId = req.headers['x-user-id'] as string;
    const updates: UpdateRegionRequest = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const region = await projectStateManager.updateRegion(regionId, userId, updates);
    
    if (!region) {
      return res.status(404).json({ error: 'Region not found' });
    }

    return res.json(region);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to update region'), {
      regionId: req.params.regionId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to update region' });
  }
});

/**
 * DELETE /api/regions/:regionId
 * Delete region
 */
router.delete('/regions/:regionId', async (req, res) => {
  try {
    const { regionId } = req.params as { regionId: string };
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const success = await projectStateManager.deleteRegion(regionId, userId);
    
    if (!success) {
      return res.status(404).json({ error: 'Region not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to delete region'), {
      regionId: req.params.regionId,
      userId: req.headers['x-user-id'],
    });
    return res.status(500).json({ error: 'Failed to delete region' });
  }
});

// ============================================================================
// Statistics and Monitoring
// ============================================================================

/**
 * GET /api/projects/stats
 * Get project statistics
 */
router.get('/projects/stats', async (req, res) => {
  try {
    const stats = await projectStateManager.getStats();
    return res.json(stats);
  } catch (error) {
    loggingService.logError(error instanceof Error ? error : new Error('Failed to get project statistics'));
    return res.status(500).json({ error: 'Failed to get statistics' });
  }
});

export default router;