import { Router, Request, Response } from 'express';
import multer from 'multer';
// import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { UploadAudioFileRequest } from '../types/daw';
import { AudioFileSyncService } from '../services/AudioFileSyncService';
import { AudioFileStorageService } from '../services/AudioFileStorageService';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { loggingService } from '../services/LoggingService';
import Joi from 'joi';

const router = Router();

// Initialize services
const audioFileSyncService = AudioFileSyncService.getInstance();
const audioFileStorageService = AudioFileStorageService.getInstance();
const projectStateManager = ProjectStateManager.getInstance();

// ============================================================================
// Multer Configuration for Audio File Uploads
// ============================================================================

const storage = multer.memoryStorage(); // Store in memory for processing

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check file type
  const allowedMimeTypes = [
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/mpeg',
    'audio/mp3',
    'audio/flac',
    'audio/x-flac',
    'audio/aac',
    'audio/mp4',
    'audio/x-m4a',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1, // Single file upload
  },
});

// ============================================================================
// Validation Schemas
// ============================================================================

const uploadAudioFileSchema = Joi.object({
  projectId: Joi.string().required(),
  roomId: Joi.string().required(),
});

const verifyIntegritySchema = Joi.object({
  clientHash: Joi.string().required(),
});

// ============================================================================
// Audio File Upload Routes
// ============================================================================

// Upload audio file with automatic distribution
router.post('/upload', upload.single('audioFile'), async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No audio file provided',
      });
    }

    const { error, value } = uploadAudioFileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const { projectId, roomId } = value;

    // Verify project exists and user has access
    const project = await projectStateManager.getProject(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }

    if (project.roomId !== roomId) {
      return res.status(400).json({
        success: false,
        error: 'Project does not belong to the specified room',
      });
    }

    // Determine file format from mimetype and filename
    const format = getFileFormat(req.file.mimetype, req.file.originalname);

    // Create upload request
    const uploadRequest: UploadAudioFileRequest = {
      projectId,
      file: req.file.buffer,
      filename: `${uuidv4()}.${format}`,
      originalName: req.file.originalname,
      format,
    };

    // Upload and distribute the audio file
    const audioFile = await audioFileSyncService.uploadAndDistributeAudioFile(
      uploadRequest,
      userId,
      roomId
    );

    return res.status(201).json({
      success: true,
      data: audioFile,
      message: 'Audio file uploaded and distributed successfully',
    });

  } catch (error) {
    loggingService.logError('Failed to upload audio file', {
      userId: req.headers['x-user-id'],
      projectId: req.body.projectId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to upload audio file';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Batch upload multiple audio files
router.post('/batch-upload', upload.array('audioFiles', 10), async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No audio files provided',
      });
    }

    const { error, value } = uploadAudioFileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const { projectId, roomId } = value;

    // Verify project exists and user has access
    const project = await projectStateManager.getProject(projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
      });
    }

    if (project.roomId !== roomId) {
      return res.status(400).json({
        success: false,
        error: 'Project does not belong to the specified room',
      });
    }

    // Process files in parallel
    const uploadPromises = req.files.map(async (file) => {
      const format = getFileFormat(file.mimetype, file.originalname);
      
      const uploadRequest: UploadAudioFileRequest = {
        projectId,
        file: file.buffer,
        filename: `${uuidv4()}.${format}`,
        originalName: file.originalname,
        format,
      };

      return audioFileSyncService.uploadAndDistributeAudioFile(
        uploadRequest,
        userId,
        roomId
      );
    });

    const results = await Promise.allSettled(uploadPromises);
    
    const successful: any[] = [];
    const failed: any[] = [];

    const files = req.files as Express.Multer.File[];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          filename: files[index]?.originalname,
          error: result.reason.message,
        });
      }
    });

    return res.status(201).json({
      success: true,
      data: {
        successful,
        failed,
        totalFiles: req.files.length,
        successCount: successful.length,
        failureCount: failed.length,
      },
      message: `Batch upload completed: ${successful.length} successful, ${failed.length} failed`,
    });

  } catch (error) {
    loggingService.logError('Failed to batch upload audio files', {
      userId: req.headers['x-user-id'],
      projectId: req.body.projectId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to batch upload audio files';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// ============================================================================
// Audio File Distribution Routes
// ============================================================================

// Distribute audio files to a new user joining a room
router.post('/distribute/:roomId/:userId', async (req: Request, res: Response) => {
  try {
    const { roomId, userId } = req.params as { roomId: string; userId: string };
    const requestingUserId = req.headers['x-user-id'] as string;
    
    if (!requestingUserId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    // Start distribution process
    await audioFileSyncService.distributeAudioFilesToNewUser(userId, roomId);

    return res.json({
      success: true,
      message: 'Audio file distribution initiated',
      targetUserId: userId,
      roomId,
    });

  } catch (error) {
    loggingService.logError('Failed to distribute audio files to user', {
      roomId: req.params.roomId,
      userId: req.params.userId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to distribute audio files';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Preload audio files for a project
router.post('/preload/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const userId = req.headers['x-user-id'] as string;
    const { priority = 'medium' } = req.body;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User ID required',
      });
    }

    if (!['high', 'medium', 'low'].includes(priority)) {
      return res.status(400).json({
        success: false,
        error: 'Priority must be high, medium, or low',
      });
    }

    await audioFileSyncService.preloadAudioFilesForProject(projectId, userId, priority);

    return res.json({
      success: true,
      message: 'Audio file preloading initiated',
      projectId,
      priority,
    });

  } catch (error) {
    loggingService.logError('Failed to preload audio files', {
      projectId: req.params.projectId,
      userId: req.headers['x-user-id'],
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to preload audio files';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// ============================================================================
// Audio File Integrity and Metadata Routes
// ============================================================================

// Verify audio file integrity
router.post('/:audioFileId/verify-integrity', async (req: Request, res: Response) => {
  try {
    const { audioFileId } = req.params as { audioFileId: string };
    
    const { error, value } = verifyIntegritySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details?.[0]?.message ?? 'Invalid request',
      });
    }

    const { clientHash } = value;
    const result = await audioFileSyncService.verifyAudioFileIntegrity(audioFileId, clientHash);

    return res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    loggingService.logError('Failed to verify audio file integrity', {
      audioFileId: req.params.audioFileId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to verify audio file integrity';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get audio file sync metadata
router.get('/:audioFileId/sync-metadata', async (req: Request, res: Response) => {
  try {
    const { audioFileId } = req.params as { audioFileId: string };
    
    const metadata = await audioFileSyncService.getAudioFileSyncMetadata(audioFileId);
    
    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'Audio file sync metadata not found',
      });
    }

    return res.json({
      success: true,
      data: metadata,
    });

  } catch (error) {
    loggingService.logError('Failed to get audio file sync metadata', {
      audioFileId: req.params.audioFileId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to get sync metadata';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// ============================================================================
// Audio File Download Routes (Enhanced)
// ============================================================================

// Download audio file with compression support
router.get('/:audioFileId/download', async (req: Request, res: Response) => {
  try {
    const { audioFileId } = req.params as { audioFileId: string };
    const { compressed = 'false' } = req.query;
    
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

    let responseBuffer = fileBuffer;
    let contentType = `audio/${audioFile.format}`;
    let filename = audioFile.originalName;

    // Handle compression if requested
    if (compressed === 'true') {
      try {
        responseBuffer = await audioFileSyncService.decompressAudioFile(fileBuffer);
        contentType = 'application/gzip';
        filename = `${audioFile.originalName}.gz`;
      } catch (error) {
        // If decompression fails, send original file
        loggingService.logError('Failed to decompress audio file for download', {
          audioFileId,
          error,
        });
      }
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', responseBuffer.length);
    res.setHeader('X-Audio-File-Id', audioFileId);
    res.setHeader('X-Original-Size', fileBuffer.length.toString());
    
  return res.send(responseBuffer);

  } catch (error) {
    loggingService.logError('Failed to download audio file', {
      audioFileId: req.params.audioFileId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to download audio file';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Stream audio file in chunks
router.get('/:audioFileId/stream', async (req: Request, res: Response) => {
  try {
    const { audioFileId } = req.params as { audioFileId: string };
    const range = req.headers.range;
    
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

    const fileSize = fileBuffer.length;
    
    if (range) {
      // Handle range requests for streaming
  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0] || '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      
      const chunk = fileBuffer.slice(start, end + 1);
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', `audio/${audioFile.format}`);
      
      return res.send(chunk);
    } else {
      // Send entire file
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Type', `audio/${audioFile.format}`);
      res.setHeader('Accept-Ranges', 'bytes');
      
      return res.send(fileBuffer);
    }

  } catch (error) {
    loggingService.logError('Failed to stream audio file', {
      audioFileId: req.params.audioFileId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to stream audio file';
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// ============================================================================
// Cache Management Routes
// ============================================================================

// Clear audio file cache
router.delete('/cache/:audioFileId?', async (req: Request, res: Response) => {
  try {
    const { audioFileId } = req.params;
    
    await audioFileSyncService.clearAudioFileCache(audioFileId);
    
    res.json({
      success: true,
      message: audioFileId 
        ? `Cache cleared for audio file ${audioFileId}`
        : 'All audio file caches cleared',
    });

  } catch (error) {
    loggingService.logError('Failed to clear audio file cache', {
      audioFileId: req.params.audioFileId,
      error,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to clear cache';
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get cache statistics
router.get('/cache/stats', async (req: Request, res: Response) => {
  try {
    const stats = await audioFileSyncService.getCacheStats();
    
    res.json({
      success: true,
      data: stats,
    });

  } catch (error) {
    loggingService.logError('Failed to get cache statistics', { error });

    const errorMessage = error instanceof Error ? error.message : 'Failed to get cache statistics';
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// ============================================================================
// Utility Functions
// ============================================================================

function getFileFormat(mimetype: string, filename: string): string {
  // Try to determine format from mimetype first
  const mimetypeMap: Record<string, string> = {
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  };

  if (mimetypeMap[mimetype]) {
    return mimetypeMap[mimetype];
  }

  // Fallback to file extension
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension || 'wav';
}

export default router;