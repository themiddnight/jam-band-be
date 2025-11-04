import { Router, Request, Response } from 'express';
import { MixerStateManager } from '../services/MixerStateManager';
import { loggingService } from '../services/LoggingService';

const router = Router();
const mixerStateManager = MixerStateManager.getInstance();

/**
 * Mixer state API routes
 */

/**
 * GET /api/projects/:projectId/mixer-state
 * Get mixer state for a project
 */
router.get('/projects/:projectId/mixer-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id || 'anonymous'; // Assuming user is attached to request

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Get mixer state
    const mixerState = await mixerStateManager.getMixerState(projectId);

    if (!mixerState) {
      return res.status(404).json({
        error: 'Mixer state not found',
      });
    }

    // Log access
    loggingService.logInfo('Mixer state retrieved', {
      projectId,
      userId,
      version: mixerState.version,
      tracksCount: mixerState.mixerState?.tracks?.length || 0,
    });

    res.json({
      success: true,
      data: mixerState.mixerState,
      version: mixerState.version,
      lastSaved: mixerState.lastSaved,
      updatedAt: mixerState.updatedAt,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get mixer state'),
      { projectId: req.params.projectId }
    );

    res.status(500).json({
      error: 'Failed to retrieve mixer state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/projects/:projectId/mixer-state
 * Save mixer state for a project
 */
router.put('/projects/:projectId/mixer-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id || 'anonymous';
    const { mixerState, changes, timestamp } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    if (!mixerState) {
      return res.status(400).json({
        error: 'Mixer state is required',
      });
    }

    // Validate mixer state structure
    if (!isValidMixerState(mixerState)) {
      return res.status(400).json({
        error: 'Invalid mixer state structure',
      });
    }

    // Save mixer state
    const savedState = await mixerStateManager.saveMixerState(
      projectId,
      userId,
      mixerState,
      changes
    );

    // Log save
    loggingService.logInfo('Mixer state saved', {
      projectId,
      userId,
      version: savedState.version,
      changesCount: changes?.length || 0,
      tracksCount: mixerState.tracks?.length || 0,
    });

    res.json({
      success: true,
      data: {
        id: savedState.id,
        version: savedState.version,
        lastSaved: savedState.lastSaved,
        updatedAt: savedState.updatedAt,
      },
      message: 'Mixer state saved successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to save mixer state'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to save mixer state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/projects/:projectId/mixer-state/force-save
 * Force immediate save of mixer state
 */
router.post('/projects/:projectId/mixer-state/force-save', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id || 'anonymous';
    const { mixerState, changes } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    if (!mixerState) {
      return res.status(400).json({
        error: 'Mixer state is required',
      });
    }

    // Force save mixer state
    const savedState = await mixerStateManager.forceMixerStateSave(
      projectId,
      userId,
      mixerState,
      changes
    );

    // Log force save
    loggingService.logInfo('Mixer state force saved', {
      projectId,
      userId,
      version: savedState.version,
      changesCount: changes?.length || 0,
      tracksCount: mixerState.tracks?.length || 0,
    });

    res.json({
      success: true,
      data: {
        id: savedState.id,
        version: savedState.version,
        lastSaved: savedState.lastSaved,
        updatedAt: savedState.updatedAt,
      },
      message: 'Mixer state force saved successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to force save mixer state'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to force save mixer state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/projects/:projectId/mixer-state
 * Delete mixer state for a project
 */
router.delete('/projects/:projectId/mixer-state', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id || 'anonymous';

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Delete mixer state
    const success = await mixerStateManager.deleteMixerState(projectId, userId);

    if (!success) {
      return res.status(404).json({
        error: 'Mixer state not found or could not be deleted',
      });
    }

    // Log deletion
    loggingService.logInfo('Mixer state deleted', {
      projectId,
      userId,
    });

    res.json({
      success: true,
      message: 'Mixer state deleted successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to delete mixer state'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to delete mixer state',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/projects/:projectId/mixer-changes
 * Get mixer changes for a project
 */
router.get('/projects/:projectId/mixer-changes', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { since, limit, trackId, effectId } = req.query;
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
      changes = await mixerStateManager.getMixerChangesSince(
        projectId, 
        sinceDate,
        trackId as string,
        effectId as string
      );
    } else {
      // Get recent changes
      const changeLimit = limit ? parseInt(limit as string, 10) : 50;
      if (isNaN(changeLimit) || changeLimit < 1 || changeLimit > 1000) {
        return res.status(400).json({
          error: 'Invalid limit parameter (must be between 1 and 1000)',
        });
      }
      changes = await mixerStateManager.getRecentMixerChanges(
        projectId, 
        changeLimit,
        trackId as string,
        effectId as string
      );
    }

    // Log access
    loggingService.logInfo('Mixer changes retrieved', {
      projectId,
      userId,
      changesCount: changes.length,
      since: since || null,
      limit: limit || null,
      trackId: trackId || null,
      effectId: effectId || null,
    });

    res.json({
      success: true,
      data: changes,
      count: changes.length,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get mixer changes'),
      { projectId: req.params.projectId }
    );

    res.status(500).json({
      error: 'Failed to retrieve mixer changes',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/projects/:projectId/mixer-state/effects-sync-status
 * Get effects synchronization status for a project
 */
router.get('/projects/:projectId/mixer-state/effects-sync-status', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id || 'anonymous';

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Get effects sync status
    const syncStatus = await mixerStateManager.getEffectsSyncStatus(projectId);

    // Log access
    loggingService.logInfo('Effects sync status retrieved', {
      projectId,
      userId,
      syncStatus: syncStatus.status,
      pendingEffects: syncStatus.pendingEffects,
    });

    res.json({
      success: true,
      data: syncStatus,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get effects sync status'),
      { projectId: req.params.projectId }
    );

    res.status(500).json({
      error: 'Failed to retrieve effects sync status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/projects/:projectId/mixer-state/sync-effects
 * Force synchronization of effects for a project
 */
router.post('/projects/:projectId/mixer-state/sync-effects', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id || 'anonymous';
    const { trackId, effectId } = req.body;

    if (!projectId) {
      return res.status(400).json({
        error: 'Project ID is required',
      });
    }

    // Force effects synchronization
    const syncResult = await mixerStateManager.forceEffectsSync(
      projectId,
      userId,
      trackId,
      effectId
    );

    // Log sync
    loggingService.logInfo('Effects sync forced', {
      projectId,
      userId,
      trackId: trackId || null,
      effectId: effectId || null,
      syncedEffects: syncResult.syncedEffects,
    });

    res.json({
      success: true,
      data: syncResult,
      message: 'Effects synchronization completed',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to force effects sync'),
      { 
        projectId: req.params.projectId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to force effects synchronization',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/mixer-state/stats
 * Get mixer state manager statistics
 */
router.get('/mixer-state/stats', async (req: Request, res: Response) => {
  try {
    const stats = await mixerStateManager.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get mixer state stats'),
      {}
    );

    res.status(500).json({
      error: 'Failed to retrieve mixer state statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate mixer state structure
 */
function isValidMixerState(mixerState: any): boolean {
  if (!mixerState || typeof mixerState !== 'object') {
    return false;
  }

  // Check required properties
  const requiredProperties = ['tracks', 'masterLevel', 'masterMuted'];
  for (const prop of requiredProperties) {
    if (!(prop in mixerState)) {
      return false;
    }
  }

  // Validate tracks array
  if (!Array.isArray(mixerState.tracks)) {
    return false;
  }

  // Validate each track
  for (const track of mixerState.tracks) {
    if (!isValidTrackMixerState(track)) {
      return false;
    }
  }

  // Validate master level and mute
  if (typeof mixerState.masterLevel !== 'number' || 
      typeof mixerState.masterMuted !== 'boolean') {
    return false;
  }

  return true;
}

/**
 * Validate track mixer state structure
 */
function isValidTrackMixerState(track: any): boolean {
  if (!track || typeof track !== 'object') {
    return false;
  }

  const requiredProps = ['id', 'level', 'muted', 'soloed', 'pan', 'effectsEnabled', 'effects'];
  for (const prop of requiredProps) {
    if (!(prop in track)) {
      return false;
    }
  }

  // Validate types
  if (typeof track.id !== 'string' ||
      typeof track.level !== 'number' ||
      typeof track.muted !== 'boolean' ||
      typeof track.soloed !== 'boolean' ||
      typeof track.pan !== 'number' ||
      typeof track.effectsEnabled !== 'boolean' ||
      !Array.isArray(track.effects)) {
    return false;
  }

  // Validate effects
  for (const effect of track.effects) {
    if (!isValidEffectState(effect)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate effect state structure
 */
function isValidEffectState(effect: any): boolean {
  if (!effect || typeof effect !== 'object') {
    return false;
  }

  const requiredProps = ['id', 'type', 'name', 'bypassed', 'parameters', 'order'];
  for (const prop of requiredProps) {
    if (!(prop in effect)) {
      return false;
    }
  }

  // Validate types
  if (typeof effect.id !== 'string' ||
      typeof effect.type !== 'string' ||
      typeof effect.name !== 'string' ||
      typeof effect.bypassed !== 'boolean' ||
      typeof effect.order !== 'number' ||
      !Array.isArray(effect.parameters)) {
    return false;
  }

  // Validate parameters
  for (const param of effect.parameters) {
    if (!isValidEffectParameter(param)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate effect parameter structure
 */
function isValidEffectParameter(param: any): boolean {
  if (!param || typeof param !== 'object') {
    return false;
  }

  const requiredProps = ['id', 'name', 'value'];
  for (const prop of requiredProps) {
    if (!(prop in param)) {
      return false;
    }
  }

  return (
    typeof param.id === 'string' &&
    typeof param.name === 'string' &&
    typeof param.value === 'number'
  );
}

export default router;