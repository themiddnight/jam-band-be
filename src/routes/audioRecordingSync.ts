import { Router } from 'express';
import { AudioFileSyncService } from '../services/AudioFileSyncService';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { loggingService } from '../services/LoggingService';
import type { 
  AudioFileRecord,
  UploadAudioFileRequest,
} from '../types/daw';

const router = Router();
const audioFileSyncService = AudioFileSyncService.getInstance();
const projectStateManager = ProjectStateManager.getInstance();

/**
 * Upload recorded audio file with automatic distribution
 */
router.post('/upload-recording', async (req, res) => {
  try {
    const { roomId, trackId, regionId } = req.body;
    const userId = req.headers['x-user-id'] as string;
    
    if (!roomId || !trackId || !regionId || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: roomId, trackId, regionId, userId'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: 'No audio file provided'
      });
    }

    // Create upload request
    const uploadRequest: UploadAudioFileRequest = {
      projectId: roomId, // Using roomId as projectId for now
      filename: req.file.originalname || `recording_${Date.now()}.wav`,
      originalName: req.file.originalname || `Recording ${new Date().toISOString()}`,
      file: req.file.buffer,
      format: req.file.mimetype.split('/')[1] || 'wav',
    };

    // Upload and distribute the file
    const audioFile = await audioFileSyncService.uploadAndDistributeAudioFile(
      uploadRequest,
      userId,
      roomId
    );

    // Update the audio region with the file reference
    await projectStateManager.updateAudioRegion(regionId, {
      audioFileId: audioFile.id,
      audioFileName: audioFile.filename,
      audioFileUrl: audioFile.url,
    });

    loggingService.logInfo('Audio recording uploaded and distributed', {
      audioFileId: audioFile.id,
      roomId,
      trackId,
      regionId,
      userId,
      fileSize: req.file.size,
    });

    res.json({
      success: true,
      audioFile: {
        id: audioFile.id,
        filename: audioFile.filename,
        url: audioFile.url,
        size: audioFile.size,
        duration: audioFile.duration,
      },
    });

  } catch (error) {
    loggingService.logError('Failed to upload recording', {
      error: error instanceof Error ? error.message : 'Unknown error',
      roomId: req.body.roomId,
      userId: req.headers['x-user-id'],
    });

    res.status(500).json({
      error: 'Failed to upload recording',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get recording synchronization status for a room
 */
router.get('/sync-status/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    // Get all audio files for the room's projects
    const projects = await projectStateManager.getProjectsByRoom(roomId);
    const allAudioFiles: AudioFileRecord[] = [];

    for (const project of projects) {
      const audioFiles = await audioFileSyncService.getAudioFilesByProject(project.id);
      allAudioFiles.push(...audioFiles);
    }

    // Check sync status for each file
    const syncStatus = await Promise.all(
      allAudioFiles.map(async (file) => {
        const metadata = await audioFileSyncService.getAudioFileSyncMetadata(file.id);
        return {
          fileId: file.id,
          filename: file.filename,
          size: file.size,
          synced: !!metadata,
          compressed: metadata?.compressed || false,
        };
      })
    );

    res.json({
      roomId,
      totalFiles: allAudioFiles.length,
      syncedFiles: syncStatus.filter(s => s.synced).length,
      files: syncStatus,
    });

  } catch (error) {
    loggingService.logError('Failed to get sync status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      roomId: req.params.roomId,
      userId: req.headers['x-user-id'],
    });

    res.status(500).json({
      error: 'Failed to get sync status',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Verify audio file integrity
 */
router.post('/verify-file/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { clientHash } = req.body;
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    if (!clientHash) {
      return res.status(400).json({ error: 'Client hash required' });
    }

    const verification = await audioFileSyncService.verifyAudioFileIntegrity(fileId, clientHash);

    res.json({
      fileId,
      isValid: verification.isValid,
      serverHash: verification.serverHash,
    });

  } catch (error) {
    loggingService.logError('Failed to verify file integrity', {
      error: error instanceof Error ? error.message : 'Unknown error',
      fileId: req.params.fileId,
      userId: req.headers['x-user-id'],
    });

    res.status(500).json({
      error: 'Failed to verify file integrity',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Trigger file redistribution for a specific file
 */
router.post('/redistribute/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetUsers } = req.body;
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    // Get file metadata
    const audioFile = await audioFileSyncService.getAudioFileMetadata(fileId);
    if (!audioFile) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    // Redistribute to specified users or all users in the room
    const users = targetUsers || []; // Would get from room service
    
    // This would trigger redistribution through WebRTC or other means
    // For now, we'll just log the request
    loggingService.logInfo('File redistribution requested', {
      fileId,
      targetUsers: users,
      requestedBy: userId,
    });

    res.json({
      success: true,
      message: 'File redistribution initiated',
      fileId,
      targetUsers: users,
    });

  } catch (error) {
    loggingService.logError('Failed to redistribute file', {
      error: error instanceof Error ? error.message : 'Unknown error',
      fileId: req.params.fileId,
      userId: req.headers['x-user-id'],
    });

    res.status(500).json({
      error: 'Failed to redistribute file',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get recording conflicts for a room
 */
router.get('/conflicts/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    // This would typically come from a conflict tracking service
    // For now, return empty array as conflicts are handled in real-time via WebSocket
    const conflicts: any[] = [];

    res.json({
      roomId,
      conflicts,
    });

  } catch (error) {
    loggingService.logError('Failed to get recording conflicts', {
      error: error instanceof Error ? error.message : 'Unknown error',
      roomId: req.params.roomId,
      userId: req.headers['x-user-id'],
    });

    res.status(500).json({
      error: 'Failed to get recording conflicts',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Resolve a recording conflict
 */
router.post('/resolve-conflict', async (req, res) => {
  try {
    const { conflictId, resolutionId, roomId } = req.body;
    const userId = req.headers['x-user-id'] as string;

    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    if (!conflictId || !resolutionId || !roomId) {
      return res.status(400).json({
        error: 'Missing required fields: conflictId, resolutionId, roomId'
      });
    }

    // Log the conflict resolution
    loggingService.logInfo('Recording conflict resolved', {
      conflictId,
      resolutionId,
      roomId,
      resolvedBy: userId,
    });

    // In a real implementation, this would:
    // 1. Update conflict state in database
    // 2. Notify other users via WebSocket
    // 3. Take appropriate action based on resolution

    res.json({
      success: true,
      conflictId,
      resolutionId,
      resolvedBy: userId,
    });

  } catch (error) {
    loggingService.logError('Failed to resolve recording conflict', {
      error: error instanceof Error ? error.message : 'Unknown error',
      conflictId: req.body.conflictId,
      userId: req.headers['x-user-id'],
    });

    res.status(500).json({
      error: 'Failed to resolve recording conflict',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;