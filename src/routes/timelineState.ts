import { Router, Request, Response } from 'express';
import { TimelineStateManager } from '../services/TimelineStateManager';
import { loggingService } from '../services/LoggingService';

const router = Router();
const timelineStateManager = TimelineStateManager.getInstance();

/**
 * Timeline state API routes
 */

/**
 * GET /api/projects/:projectId/timeline-state
 * Get timeline state for a project
 */
router.get('/projects/:projectId/timeline-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.user?.id || 'anonymous'; // Assuming user is attached to request

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Get timeline state
    const timelineState = await timelineStateManager.getTimelineState(projectId);

    if (!timelineState) {
      return res.status(404).json({
        error: 'Timeline state not found',
      });
    }

    // Log access
    loggingService.logInfo('Timeline state retrieved', {
      projectId,
      userId,
      version: timelineState.version,
    });

    return res.json({
      success: true,
      data: timelineState.timelineState,
      version: timelineState.version,
      lastSaved: timelineState.lastSaved,
      updatedAt: timelineState.updatedAt,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get timeline state'),
      { projectId: req.params.projectId }
    );

    return res.status(500).json({
      error: 'Failed to retrieve timeline state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/projects/:projectId/timeline-state
 * Save timeline state for a project
 */
router.put('/projects/:projectId/timeline-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.user?.id || 'anonymous';
    const { timelineState, changes, timestamp: _timestamp } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    if (!timelineState) {
      return res.status(400).json({
        error: 'Timeline state is required',
      });
    }

    // Validate timeline state structure
    if (!isValidTimelineState(timelineState)) {
      return res.status(400).json({
        error: 'Invalid timeline state structure',
      });
    }

    // Save timeline state
    const savedState = await timelineStateManager.saveTimelineState(
      projectId,
      userId,
      timelineState,
      changes
    );

    // Log save
    loggingService.logInfo('Timeline state saved', {
      projectId,
      userId,
      version: savedState.version,
      changesCount: changes?.length || 0,
    });

    return res.json({
      success: true,
      data: {
        id: savedState.id,
        version: savedState.version,
        lastSaved: savedState.lastSaved,
        updatedAt: savedState.updatedAt,
      },
      message: 'Timeline state saved successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to save timeline state'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    return res.status(500).json({
      error: 'Failed to save timeline state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/projects/:projectId/timeline-state/force-save
 * Force immediate save of timeline state
 */
router.post('/projects/:projectId/timeline-state/force-save', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.user?.id || 'anonymous';
    const { timelineState, changes } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    if (!timelineState) {
      return res.status(400).json({
        error: 'Timeline state is required',
      });
    }

    // Force save timeline state
    const savedState = await timelineStateManager.forceTimelineStateSave(
      projectId,
      userId,
      timelineState,
      changes
    );

    // Log force save
    loggingService.logInfo('Timeline state force saved', {
      projectId,
      userId,
      version: savedState.version,
      changesCount: changes?.length || 0,
    });

    return res.json({
      success: true,
      data: {
        id: savedState.id,
        version: savedState.version,
        lastSaved: savedState.lastSaved,
        updatedAt: savedState.updatedAt,
      },
      message: 'Timeline state force saved successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to force save timeline state'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    return res.status(500).json({
      error: 'Failed to force save timeline state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/projects/:projectId/timeline-state
 * Delete timeline state for a project
 */
router.delete('/projects/:projectId/timeline-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.user?.id || 'anonymous';

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Delete timeline state
    const success = await timelineStateManager.deleteTimelineState(projectId, userId);

    if (!success) {
      return res.status(404).json({
        error: 'Timeline state not found or could not be deleted',
      });
    }

    // Log deletion
    loggingService.logInfo('Timeline state deleted', {
      projectId,
      userId,
    });

    return res.json({
      success: true,
      message: 'Timeline state deleted successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to delete timeline state'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    return res.status(500).json({
      error: 'Failed to delete timeline state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/projects/:projectId/timeline-changes
 * Get timeline changes for a project
 */
router.get('/projects/:projectId/timeline-changes', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const { since, limit } = req.query;
    const userId = req.user?.id || 'anonymous';

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    let changes;
    
    if (since) {
      // Get changes since specific timestamp
      const sinceDate = new Date(since as string);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({
          error: 'Invalid since timestamp',
        });
      }
      changes = await timelineStateManager.getTimelineChangesSince(projectId, sinceDate);
    } else {
      // Get recent changes
      const changeLimit = limit ? parseInt(limit as string, 10) : 50;
      if (isNaN(changeLimit) || changeLimit < 1 || changeLimit > 1000) {
        return res.status(400).json({
          error: 'Invalid limit parameter (must be between 1 and 1000)',
        });
      }
      changes = await timelineStateManager.getRecentTimelineChanges(projectId, changeLimit);
    }

    // Log access
    loggingService.logInfo('Timeline changes retrieved', {
      projectId,
      userId,
      changesCount: changes.length,
      since: since || null,
      limit: limit || null,
    });

    return res.json({
      success: true,
      data: changes,
      count: changes.length,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get timeline changes'),
      { projectId: req.params.projectId }
    );

    return res.status(500).json({
      error: 'Failed to retrieve timeline changes',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/projects/:projectId/complete-state
 * Get complete project state including timeline state
 */
router.get('/projects/:projectId/complete-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.user?.id || 'anonymous';

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Get complete project state with timeline
    const completeState = await timelineStateManager.getCompleteProjectStateWithTimeline(projectId);

    if (!completeState) {
      return res.status(404).json({
        error: 'Project state not found',
      });
    }

    // Log access
    loggingService.logInfo('Complete project state with timeline retrieved', {
      projectId,
      userId,
      hasTimeline: !!completeState.timeline,
      timelineVersion: completeState.timelineVersion || 0,
    });

    return res.json({
      success: true,
      data: completeState,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get complete project state'),
      { projectId: req.params.projectId }
    );

    return res.status(500).json({
      error: 'Failed to retrieve complete project state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/timeline-state/stats
 * Get timeline state manager statistics
 */
router.get('/timeline-state/stats', async (req: Request, res: Response) => {
  try {
    const stats = await timelineStateManager.getStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get timeline state stats'),
      {}
    );

    return res.status(500).json({
      error: 'Failed to retrieve timeline state statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate timeline state structure
 */
function isValidTimelineState(timelineState: any): boolean {
  if (!timelineState || typeof timelineState !== 'object') {
    return false;
  }

  // Check required properties
  const requiredProperties = ['viewport', 'grid', 'cursor'];
  for (const prop of requiredProperties) {
    if (!(prop in timelineState)) {
      return false;
    }
  }

  // Validate viewport
  if (!isValidViewport(timelineState.viewport)) {
    return false;
  }

  // Validate grid
  if (!isValidGrid(timelineState.grid)) {
    return false;
  }

  // Validate cursor
  if (!isValidCursor(timelineState.cursor)) {
    return false;
  }

  return true;
}

/**
 * Validate viewport structure
 */
function isValidViewport(viewport: any): boolean {
  if (!viewport || typeof viewport !== 'object') {
    return false;
  }

  const requiredProps = ['startTime', 'endTime', 'pixelsPerBeat', 'trackHeight', 'scrollX', 'scrollY'];
  for (const prop of requiredProps) {
    if (typeof viewport[prop] !== 'number') {
      return false;
    }
  }

  return true;
}

/**
 * Validate grid structure
 */
function isValidGrid(grid: any): boolean {
  if (!grid || typeof grid !== 'object') {
    return false;
  }

  return (
    typeof grid.enabled === 'boolean' &&
    typeof grid.resolution === 'number' &&
    typeof grid.showSubdivisions === 'boolean' &&
    typeof grid.snapEnabled === 'boolean'
  );
}

/**
 * Validate cursor structure
 */
function isValidCursor(cursor: any): boolean {
  if (!cursor || typeof cursor !== 'object') {
    return false;
  }

  return (
    typeof cursor.position === 'number' &&
    typeof cursor.visible === 'boolean' &&
    typeof cursor.following === 'boolean'
  );
}

export default router;