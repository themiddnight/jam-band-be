import { Router, Request, Response } from 'express';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { TimelineStateManager } from '../services/TimelineStateManager';
import { loggingService } from '../services/LoggingService';

const router = Router();
const projectStateManager = ProjectStateManager.getInstance();
const timelineStateManager = TimelineStateManager.getInstance();

/**
 * MIDI Region API routes for piano roll persistence
 */

/**
 * GET /api/projects/:projectId/midi-regions/:regionId
 * Get MIDI region data for piano roll editor
 */
router.get('/projects/:projectId/midi-regions/:regionId', async (req: Request, res: Response) => {
  try {
    const { projectId, regionId } = req.params;
    const userId = req.user?.id || 'anonymous';

    if (!projectId || !regionId) {
      return res.status(400).json({
        error: 'Project ID and Region ID are required',
      });
    }

    // Get complete project state
    const projectState = await projectStateManager.getCompleteProjectState(projectId);

    if (!projectState) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Find the MIDI region
    let midiRegion = null;
    for (const track of projectState.tracks) {
      if (track.type === 'midi') {
        const region = track.regions.find((r: any) => r.id === regionId);
        if (region) {
          midiRegion = region;
          break;
        }
      }
    }

    if (!midiRegion) {
      return res.status(404).json({
        error: 'MIDI region not found',
      });
    }

    // Log access
    loggingService.logInfo('MIDI region retrieved', {
      projectId,
      regionId,
      userId,
      notesCount: midiRegion.notes?.length || 0,
    });

    res.json({
      success: true,
      data: midiRegion,
      metadata: {
        projectId,
        regionId,
        notesCount: midiRegion.notes?.length || 0,
        lastUpdated: midiRegion.updatedAt,
      },
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get MIDI region'),
      { projectId: req.params.projectId, regionId: req.params.regionId }
    );

    res.status(500).json({
      error: 'Failed to retrieve MIDI region',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/projects/:projectId/midi-regions/:regionId
 * Save MIDI region data from piano roll editor
 */
router.put('/projects/:projectId/midi-regions/:regionId', async (req: Request, res: Response) => {
  try {
    const { projectId, regionId } = req.params;
    const userId = req.user?.id || 'anonymous';
    const { region, changes, timestamp } = req.body;

    if (!projectId || !regionId) {
      return res.status(400).json({
        error: 'Project ID and Region ID are required',
      });
    }

    if (!region) {
      return res.status(400).json({
        error: 'Region data is required',
      });
    }

    // Validate region structure
    if (!isValidMIDIRegion(region)) {
      return res.status(400).json({
        error: 'Invalid MIDI region structure',
      });
    }

    // Get current project state
    const projectState = await projectStateManager.getCompleteProjectState(projectId);

    if (!projectState) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Find and update the MIDI region
    let regionUpdated = false;
    let trackId = null;

    for (const track of projectState.tracks) {
      if (track.type === 'midi') {
        const regionIndex = track.regions.findIndex((r: any) => r.id === regionId);
        if (regionIndex !== -1) {
          // Update the region
          track.regions[regionIndex] = {
            ...track.regions[regionIndex],
            ...region,
            updatedAt: new Date(),
          };
          trackId = track.id;
          regionUpdated = true;
          break;
        }
      }
    }

    if (!regionUpdated) {
      return res.status(404).json({
        error: 'MIDI region not found in project',
      });
    }

    // Save updated project state
    const savedState = await projectStateManager.saveProjectState(
      projectId,
      userId,
      projectState
    );

    // Record changes if provided
    if (changes && changes.length > 0) {
      await recordMIDIRegionChanges(projectId, regionId, userId, changes);
    }

    // Sync with timeline state if needed
    if (trackId) {
      await timelineStateManager.syncTimelineWithProjectChanges(
        projectId,
        userId,
        [{
          changeType: 'region_update',
          data: { regionId, trackId, region },
          timestamp: new Date(),
        }]
      );
    }

    // Log save
    loggingService.logInfo('MIDI region saved', {
      projectId,
      regionId,
      userId,
      notesCount: region.notes?.length || 0,
      changesCount: changes?.length || 0,
      version: savedState.version,
    });

    res.json({
      success: true,
      data: {
        regionId,
        version: savedState.version,
        lastSaved: new Date(),
        notesCount: region.notes?.length || 0,
      },
      message: 'MIDI region saved successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to save MIDI region'),
      { 
        projectId: req.params.projectId,
        regionId: req.params.regionId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to save MIDI region',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/projects/:projectId/midi-regions/:regionId/notes
 * Add a note to a MIDI region
 */
router.post('/projects/:projectId/midi-regions/:regionId/notes', async (req: Request, res: Response) => {
  try {
    const { projectId, regionId } = req.params;
    const userId = req.user?.id || 'anonymous';
    const { note } = req.body;

    if (!projectId || !regionId) {
      return res.status(400).json({
        error: 'Project ID and Region ID are required',
      });
    }

    if (!note || !isValidMIDINote(note)) {
      return res.status(400).json({
        error: 'Valid note data is required',
      });
    }

    // Get current project state
    const projectState = await projectStateManager.getCompleteProjectState(projectId);

    if (!projectState) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Find and update the MIDI region
    let regionUpdated = false;
    let updatedRegion = null;

    for (const track of projectState.tracks) {
      if (track.type === 'midi') {
        const regionIndex = track.regions.findIndex((r: any) => r.id === regionId);
        if (regionIndex !== -1) {
          const region = track.regions[regionIndex];
          
          // Add the note
          const newNote = {
            ...note,
            id: generateNoteId(),
            createdAt: new Date(),
            createdBy: userId,
          };
          
          region.notes = region.notes || [];
          region.notes.push(newNote);
          region.updatedAt = new Date();
          
          updatedRegion = region;
          regionUpdated = true;
          break;
        }
      }
    }

    if (!regionUpdated) {
      return res.status(404).json({
        error: 'MIDI region not found in project',
      });
    }

    // Save updated project state
    await projectStateManager.saveProjectState(projectId, userId, projectState);

    // Log note addition
    loggingService.logInfo('MIDI note added', {
      projectId,
      regionId,
      userId,
      pitch: note.pitch,
      velocity: note.velocity,
    });

    res.json({
      success: true,
      data: {
        note: updatedRegion.notes[updatedRegion.notes.length - 1],
        regionId,
        notesCount: updatedRegion.notes.length,
      },
      message: 'Note added successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to add MIDI note'),
      { 
        projectId: req.params.projectId,
        regionId: req.params.regionId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to add MIDI note',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/projects/:projectId/midi-regions/:regionId/notes/:noteId
 * Update a note in a MIDI region
 */
router.put('/projects/:projectId/midi-regions/:regionId/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { projectId, regionId, noteId } = req.params;
    const userId = req.user?.id || 'anonymous';
    const { updates } = req.body;

    if (!projectId || !regionId || !noteId) {
      return res.status(400).json({
        error: 'Project ID, Region ID, and Note ID are required',
      });
    }

    if (!updates) {
      return res.status(400).json({
        error: 'Note updates are required',
      });
    }

    // Get current project state
    const projectState = await projectStateManager.getCompleteProjectState(projectId);

    if (!projectState) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Find and update the note
    let noteUpdated = false;
    let updatedNote = null;

    for (const track of projectState.tracks) {
      if (track.type === 'midi') {
        const region = track.regions.find((r: any) => r.id === regionId);
        if (region && region.notes) {
          const noteIndex = region.notes.findIndex((n: any) => n.id === noteId);
          if (noteIndex !== -1) {
            // Update the note
            region.notes[noteIndex] = {
              ...region.notes[noteIndex],
              ...updates,
            };
            region.updatedAt = new Date();
            
            updatedNote = region.notes[noteIndex];
            noteUpdated = true;
            break;
          }
        }
      }
    }

    if (!noteUpdated) {
      return res.status(404).json({
        error: 'MIDI note not found',
      });
    }

    // Save updated project state
    await projectStateManager.saveProjectState(projectId, userId, projectState);

    // Log note update
    loggingService.logInfo('MIDI note updated', {
      projectId,
      regionId,
      noteId,
      userId,
      updates: Object.keys(updates),
    });

    res.json({
      success: true,
      data: {
        note: updatedNote,
        noteId,
        regionId,
      },
      message: 'Note updated successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to update MIDI note'),
      { 
        projectId: req.params.projectId,
        regionId: req.params.regionId,
        noteId: req.params.noteId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to update MIDI note',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/projects/:projectId/midi-regions/:regionId/notes/:noteId
 * Delete a note from a MIDI region
 */
router.delete('/projects/:projectId/midi-regions/:regionId/notes/:noteId', async (req: Request, res: Response) => {
  try {
    const { projectId, regionId, noteId } = req.params;
    const userId = req.user?.id || 'anonymous';

    if (!projectId || !regionId || !noteId) {
      return res.status(400).json({
        error: 'Project ID, Region ID, and Note ID are required',
      });
    }

    // Get current project state
    const projectState = await projectStateManager.getCompleteProjectState(projectId);

    if (!projectState) {
      return res.status(404).json({
        error: 'Project not found',
      });
    }

    // Find and delete the note
    let noteDeleted = false;
    let deletedNote = null;

    for (const track of projectState.tracks) {
      if (track.type === 'midi') {
        const region = track.regions.find((r: any) => r.id === regionId);
        if (region && region.notes) {
          const noteIndex = region.notes.findIndex((n: any) => n.id === noteId);
          if (noteIndex !== -1) {
            // Delete the note
            deletedNote = region.notes[noteIndex];
            region.notes.splice(noteIndex, 1);
            region.updatedAt = new Date();
            
            noteDeleted = true;
            break;
          }
        }
      }
    }

    if (!noteDeleted) {
      return res.status(404).json({
        error: 'MIDI note not found',
      });
    }

    // Save updated project state
    await projectStateManager.saveProjectState(projectId, userId, projectState);

    // Log note deletion
    loggingService.logInfo('MIDI note deleted', {
      projectId,
      regionId,
      noteId,
      userId,
      pitch: deletedNote?.pitch,
    });

    res.json({
      success: true,
      data: {
        noteId,
        regionId,
        deletedNote,
      },
      message: 'Note deleted successfully',
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to delete MIDI note'),
      { 
        projectId: req.params.projectId,
        regionId: req.params.regionId,
        noteId: req.params.noteId,
        userId: req.user?.id || 'anonymous',
      }
    );

    res.status(500).json({
      error: 'Failed to delete MIDI note',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/projects/:projectId/midi-regions/:regionId/changes
 * Get change history for a MIDI region
 */
router.get('/projects/:projectId/midi-regions/:regionId/changes', async (req: Request, res: Response) => {
  try {
    const { projectId, regionId } = req.params;
    const { since, limit } = req.query;
    const userId = req.user?.id || 'anonymous';

    if (!projectId || !regionId) {
      return res.status(400).json({
        error: 'Project ID and Region ID are required',
      });
    }

    // Get MIDI region changes
    const changes = await getMIDIRegionChanges(
      projectId,
      regionId,
      since ? new Date(since as string) : undefined,
      limit ? parseInt(limit as string, 10) : 50
    );

    // Log access
    loggingService.logInfo('MIDI region changes retrieved', {
      projectId,
      regionId,
      userId,
      changesCount: changes.length,
    });

    res.json({
      success: true,
      data: changes,
      count: changes.length,
    });
  } catch (error) {
    loggingService.logError(
      error instanceof Error ? error : new Error('Failed to get MIDI region changes'),
      { 
        projectId: req.params.projectId,
        regionId: req.params.regionId,
      }
    );

    res.status(500).json({
      error: 'Failed to retrieve MIDI region changes',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate MIDI region structure
 */
function isValidMIDIRegion(region: any): boolean {
  if (!region || typeof region !== 'object') {
    return false;
  }

  // Check required properties
  const requiredProps = ['id', 'trackId', 'startTime', 'duration', 'type'];
  for (const prop of requiredProps) {
    if (!(prop in region)) {
      return false;
    }
  }

  // Check type
  if (region.type !== 'midi') {
    return false;
  }

  // Validate notes array
  if (region.notes && !Array.isArray(region.notes)) {
    return false;
  }

  // Validate each note
  if (region.notes) {
    for (const note of region.notes) {
      if (!isValidMIDINote(note)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Validate MIDI note structure
 */
function isValidMIDINote(note: any): boolean {
  if (!note || typeof note !== 'object') {
    return false;
  }

  return (
    typeof note.pitch === 'number' &&
    note.pitch >= 0 && note.pitch <= 127 &&
    typeof note.velocity === 'number' &&
    note.velocity >= 0 && note.velocity <= 127 &&
    typeof note.startTime === 'number' &&
    note.startTime >= 0 &&
    typeof note.duration === 'number' &&
    note.duration > 0 &&
    typeof note.channel === 'number' &&
    note.channel >= 0 && note.channel <= 15
  );
}

/**
 * Generate unique note ID
 */
function generateNoteId(): string {
  return `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Record MIDI region changes (simulated storage)
 */
const midiRegionChanges = new Map<string, any[]>();

async function recordMIDIRegionChanges(
  projectId: string,
  regionId: string,
  userId: string,
  changes: any[]
): Promise<void> {
  const key = `${projectId}:${regionId}`;
  
  if (!midiRegionChanges.has(key)) {
    midiRegionChanges.set(key, []);
  }
  
  const regionChanges = midiRegionChanges.get(key)!;
  
  changes.forEach(change => {
    regionChanges.push({
      id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      projectId,
      regionId,
      userId,
      changeType: change.type,
      changeData: change.data,
      timestamp: new Date(change.timestamp),
    });
  });
  
  // Keep only last 1000 changes per region
  if (regionChanges.length > 1000) {
    regionChanges.splice(0, regionChanges.length - 1000);
  }
}

/**
 * Get MIDI region changes (simulated storage)
 */
async function getMIDIRegionChanges(
  projectId: string,
  regionId: string,
  since?: Date,
  limit: number = 50
): Promise<any[]> {
  const key = `${projectId}:${regionId}`;
  const changes = midiRegionChanges.get(key) || [];
  
  let filteredChanges = changes;
  
  if (since) {
    filteredChanges = changes.filter(change => change.timestamp > since);
  }
  
  return filteredChanges
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

export default router;