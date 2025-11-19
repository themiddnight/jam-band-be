import fs from 'fs';
import path from 'path';
import ffmpeg, { type FfprobeData } from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { config } from '../config/environment';
import { loggingService } from './LoggingService';
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface SaveAudioResult {
  filePath: string;
  fileName: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitrate: number;
  sizeBytes: number;
}

interface SaveAudioOptions {
  roomId: string;
  regionId: string;
  sourcePath: string;
  trackId?: string;
  originalName?: string;
}

export class AudioRegionStorageService {
  private baseDir: string;

  constructor() {
    const configuredDir =
      config.storage?.recordingsDir ||
      path.join(process.cwd(), 'record-audio');

    this.baseDir = this.ensureDirectory(configuredDir);
  }

  private ensureDirectory(targetPath: string): string {
    try {
      fs.mkdirSync(targetPath, { recursive: true });
      return targetPath;
    } catch (error) {
      loggingService.logInfo('Failed to access configured audio volume, falling back to local storage', {
        targetPath,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = path.join(process.cwd(), 'record-audio');
      fs.mkdirSync(fallback, { recursive: true });
      return fallback;
    }
  }

  private getRoomDir(roomId: string): string {
    return path.join(this.baseDir, roomId);
  }

  private getRegionFilePath(roomId: string, regionId: string): string {
    return path.join(this.getRoomDir(roomId), `${regionId}.opus`);
  }

  private getRegionMetadataPath(roomId: string, regionId: string): string {
    return path.join(this.getRoomDir(roomId), `${regionId}.json`);
  }

  async saveRegionAudio(options: SaveAudioOptions): Promise<SaveAudioResult> {
    const roomDir = this.getRoomDir(options.roomId);
    await fs.promises.mkdir(roomDir, { recursive: true });

    const outputPath = this.getRegionFilePath(options.roomId, options.regionId);
    const metadataPath = this.getRegionMetadataPath(options.roomId, options.regionId);

    // Remove previous versions if they exist
    await Promise.all([
      fs.promises.unlink(outputPath).catch(() => {}),
      fs.promises.unlink(metadataPath).catch(() => {}),
    ]);

    await this.encodeToOpus(options.sourcePath, outputPath);

    const stats = await fs.promises.stat(outputPath);
    const metadata = await this.extractMetadata(outputPath);

    const payload = {
      durationSeconds: metadata.durationSeconds,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      bitrate: metadata.bitrate,
      sizeBytes: stats.size,
      trackId: options.trackId,
      originalName: options.originalName,
      createdAt: new Date().toISOString(),
    };

    await fs.promises.writeFile(metadataPath, JSON.stringify(payload, null, 2));

    return {
      filePath: outputPath,
      fileName: path.basename(outputPath),
      durationSeconds: metadata.durationSeconds,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      bitrate: metadata.bitrate,
      sizeBytes: stats.size,
    };
  }

  async deleteRegionAudio(roomId: string, regionId: string): Promise<void> {
    const [audioPath, metadataPath] = [
      this.getRegionFilePath(roomId, regionId),
      this.getRegionMetadataPath(roomId, regionId),
    ];

    await Promise.all([
      fs.promises.unlink(audioPath).catch(() => {}),
      fs.promises.unlink(metadataPath).catch(() => {}),
    ]);
  }

  async deleteRoomAudio(roomId: string): Promise<void> {
    const roomDir = this.getRoomDir(roomId);
    await fs.promises.rm(roomDir, { recursive: true, force: true });
  }

  resolveRegionFilePath(roomId: string, regionId: string): string | null {
    const filePath = this.getRegionFilePath(roomId, regionId);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
    return null;
  }

  getRegionPlaybackPath(roomId: string, regionId: string): string {
    if (config.storage?.publicBaseUrl) {
      const url = new URL(
        `/api/rooms/${roomId}/audio/regions/${regionId}`,
        config.storage.publicBaseUrl
      );
      return url.toString();
    }
    return `/api/rooms/${roomId}/audio/regions/${regionId}`;
  }

  extractRegionIdFromPlaybackPath(playbackPath?: string | null): string | null {
    if (!playbackPath) {
      return null;
    }

    const sanitized = playbackPath.split('?')[0]?.split('#')[0] ?? playbackPath;

    try {
      const parsed = new URL(sanitized, 'http://placeholder');
      const segments = parsed.pathname.split('/').filter(Boolean);
      const regionsIndex = segments.indexOf('regions');
      if (regionsIndex !== -1 && segments.length > regionsIndex + 1) {
        const target = segments[regionsIndex + 1];
        return target ? decodeURIComponent(target) : null;
      }
      const filename = path.basename(parsed.pathname);
      return filename.replace(/\.opus$/i, '') || null;
    } catch {
      const match = sanitized.match(/\/regions\/([^/]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
      const filename = path.basename(sanitized);
      if (filename) {
        return filename.replace(/\.opus$/i, '') || null;
      }
    }

    return null;
  }

  private async encodeToOpus(inputPath: string, outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('256k')
        .audioChannels(2)
        .format('opus')
        .outputOptions(['-vbr', 'on'])
        .on('end', () => resolve())
        .on('error', (error: Error) => reject(error))
        .save(outputPath);
    });
  }

  private async extractMetadata(filePath: string): Promise<{
    durationSeconds: number;
    sampleRate: number;
    channels: number;
    bitrate: number;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: Error | null, data: FfprobeData) => {
        if (err) {
          reject(err);
          return;
        }

        const stream = data.streams?.find(
          (s: FfprobeData['streams'][number]) => s.codec_type === 'audio'
        );
        resolve({
          durationSeconds: Number(data.format?.duration ?? 0),
          sampleRate: stream?.sample_rate ? Number(stream.sample_rate) : 48000,
          channels: stream?.channels ?? 2,
          bitrate: stream?.bit_rate ? Number(stream.bit_rate) : 256000,
        });
      });
    });
  }
}

