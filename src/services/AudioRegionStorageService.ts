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
    return path.join(this.getRoomDir(roomId), `${regionId}.ogg`);
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
    const roomDir = this.getRoomDir(roomId);
    const metadataPath = this.getRegionMetadataPath(roomId, regionId);
    
    // Delete both .ogg and .opus files (for backward compatibility)
    const oggPath = path.join(roomDir, `${regionId}.ogg`);
    const opusPath = path.join(roomDir, `${regionId}.opus`);

    await Promise.all([
      fs.promises.unlink(oggPath).catch(() => {}),
      fs.promises.unlink(opusPath).catch(() => {}),
      fs.promises.unlink(metadataPath).catch(() => {}),
    ]);
  }

  async deleteRoomAudio(roomId: string): Promise<void> {
    const roomDir = this.getRoomDir(roomId);
    await fs.promises.rm(roomDir, { recursive: true, force: true });
  }

  resolveRegionFilePath(roomId: string, regionId: string): string | null {
    // Try .ogg first (new format)
    const oggPath = this.getRegionFilePath(roomId, regionId);
    if (fs.existsSync(oggPath)) {
      return oggPath;
    }
    
    // Fallback to .opus (old format) for backward compatibility
    const opusPath = path.join(this.getRoomDir(roomId), `${regionId}.opus`);
    if (fs.existsSync(opusPath)) {
      return opusPath;
    }
    
    return null;
  }

  getRegionPlaybackPath(roomId: string, regionId: string): string {
    // Use configured publicBaseUrl if available
    if (config.storage?.publicBaseUrl) {
      const url = new URL(
        `/api/rooms/${roomId}/audio/regions/${regionId}`,
        config.storage.publicBaseUrl
      );
      return url.toString();
    }
    
    // Auto-detect base URL from server configuration
    const protocol = config.ssl?.enabled ? 'https' : 'http';
    const port = config.port;
    
    // Try to get the host from FRONTEND_URL or Railway URL
    let host = 'localhost';
    if (config.cors?.frontendUrl) {
      try {
        const frontendUrl = new URL(config.cors.frontendUrl);
        host = frontendUrl.hostname;
      } catch {
        // Ignore parse errors
      }
    } else if (config.railway?.url) {
      try {
        const railwayUrl = new URL(config.railway.url);
        host = railwayUrl.hostname;
      } catch {
        // Ignore parse errors
      }
    }
    
    const baseUrl = `${protocol}://${host}:${port}`;
    const url = new URL(`/api/rooms/${roomId}/audio/regions/${regionId}`, baseUrl);
    return url.toString();
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
      return filename.replace(/\.(ogg|opus)$/i, '') || null;
    } catch {
      const match = sanitized.match(/\/regions\/([^/]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
      const filename = path.basename(sanitized);
      if (filename) {
        return filename.replace(/\.(ogg|opus)$/i, '') || null;
      }
    }

    return null;
  }

  private async encodeToOpus(inputPath: string, outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('128k')
        .audioChannels(2)
        .format('ogg') // Use Ogg container for Opus (browser-compatible)
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

