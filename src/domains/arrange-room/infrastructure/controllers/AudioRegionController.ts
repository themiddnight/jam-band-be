import { Request, Response } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { RoomService } from '../../../../services/RoomService';
import { AudioRegionStorageService } from '../../../../services/AudioRegionStorageService';
import { loggingService } from '../../../../services/LoggingService';

export class AudioRegionController {
  constructor(
    private roomService: RoomService,
    private audioStorage: AudioRegionStorageService
  ) {}

  uploadRegionAudio = async (req: Request, res: Response): Promise<void> => {
    const { roomId } = req.params;
    const {
      userId,
      regionId: bodyRegionId,
      trackId,
      originalName,
    } = req.body;
    const file = req.file;

    if (!roomId || !file) {
      res.status(400).json({ success: false, message: 'Audio file is required' });
      return;
    }

    const room = this.roomService.getRoom(roomId);
    if (!room || room.roomType !== 'arrange') {
      res.status(404).json({ success: false, message: 'Arrange room not found' });
      await this.removeTempFile(file.path);
      return;
    }

    if (!userId || !room.users.has(userId)) {
      res.status(403).json({ success: false, message: 'User not authorized for this room' });
      await this.removeTempFile(file.path);
      return;
    }

    const resolvedRegionId = typeof bodyRegionId === 'string' && bodyRegionId.length > 0
      ? bodyRegionId
      : crypto.randomUUID();

    try {
      const saveOptions = {
        roomId,
        regionId: resolvedRegionId,
        sourcePath: file.path,
        originalName: typeof originalName === 'string' ? originalName : file.originalname,
      } as {
        roomId: string;
        regionId: string;
        sourcePath: string;
        originalName: string;
        trackId?: string;
      };

      if (typeof trackId === 'string' && trackId.length > 0) {
        saveOptions.trackId = trackId;
      }

      const result = await this.audioStorage.saveRegionAudio(saveOptions);

      res.status(201).json({
        success: true,
        regionId: resolvedRegionId,
        audioUrl: this.audioStorage.getRegionPlaybackPath(roomId, resolvedRegionId),
        durationSeconds: result.durationSeconds,
        sampleRate: result.sampleRate,
        channels: result.channels,
        bitrate: result.bitrate,
        sizeBytes: result.sizeBytes,
        format: 'opus',
      });
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'AudioRegionController:uploadRegionAudio',
        roomId,
      });
      res.status(500).json({
        success: false,
        message: 'Failed to process audio recording',
      });
    } finally {
      await this.removeTempFile(file.path);
    }
  };

  streamRegionAudio = async (req: Request, res: Response): Promise<void> => {
    const { roomId, regionId } = req.params as { roomId: string; regionId: string };
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

    if (!roomId || !regionId) {
      res.status(400).json({ success: false, message: 'Room ID and region ID are required' });
      return;
    }

    const room = this.roomService.getRoom(roomId);
    if (!room || room.roomType !== 'arrange') {
      res.status(404).json({ success: false, message: 'Arrange room not found' });
      return;
    }

    if (userId && !room.users.has(userId)) {
      res.status(403).json({ success: false, message: 'User not authorized for this room' });
      return;
    }

    const filePath = this.audioStorage.resolveRegionFilePath(roomId, regionId);
    if (!filePath) {
      loggingService.logInfo('Audio file not found', {
        context: 'AudioRegionController:streamRegionAudio',
        roomId,
        regionId,
      });
      res.status(404).json({ success: false, message: 'Audio file not found' });
      return;
    }

    loggingService.logInfo('Streaming audio region', {
      context: 'AudioRegionController:streamRegionAudio',
      roomId,
      regionId,
      filePath,
    });

    try {
      const stat = await fs.promises.stat(filePath);
      const range = req.headers.range;
      const mimeType = 'audio/ogg';

      if (range) {
        const [startStr = '0', endStr] = range.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (error) {
      loggingService.logError(error as Error, {
        context: 'AudioRegionController:streamRegionAudio',
        roomId,
        regionId,
      });
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to stream audio' });
      } else {
        res.end();
      }
    }
  };

  private async removeTempFile(tempPath: string): Promise<void> {
    if (!tempPath) return;
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}

