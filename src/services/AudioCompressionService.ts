import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loggingService } from './LoggingService';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface CompressAudioResult {
  buffer: Buffer;
  fileName: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

/**
 * Service for compressing audio files to Opus/WebM format
 * Used for project file storage to reduce file sizes
 */
export class AudioCompressionService {
  /**
   * Compress audio buffer to Opus/WebM format with 320kbps bitrate
   * @param audioBuffer - Original audio file buffer
   * @param originalFileName - Original file name (for extension detection)
   * @returns Compressed audio buffer and metadata
   */
  async compressAudio(
    audioBuffer: Buffer,
    originalFileName: string
  ): Promise<CompressAudioResult> {
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `input-${Date.now()}-${Math.random().toString(36).substring(7)}.${this.getExtension(originalFileName)}`);
    const outputPath = path.join(tempDir, `output-${Date.now()}-${Math.random().toString(36).substring(7)}.webm`);

    try {
      // Write input buffer to temp file
      await fs.writeFile(inputPath, audioBuffer);

      // Compress to Opus/WebM with 320kbps
      await this.encodeToOpus(inputPath, outputPath);

      // Read compressed file
      const compressedBuffer = await fs.readFile(outputPath);

      // Get file sizes
      const originalSize = audioBuffer.length;
      const compressedSize = compressedBuffer.length;
      const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 1;

      // Generate new filename with .webm extension
      const baseName = path.parse(originalFileName).name;
      const newFileName = `${baseName}.webm`;

      loggingService.logInfo('Audio file compressed', {
        originalFileName,
        newFileName,
        originalSize,
        compressedSize,
        compressionRatio: (compressionRatio * 100).toFixed(2) + '%',
      });

      return {
        buffer: compressedBuffer,
        fileName: newFileName,
        originalSize,
        compressedSize,
        compressionRatio,
      };
    } finally {
      // Clean up temp files
      await Promise.all([
        fs.unlink(inputPath).catch(() => {}),
        fs.unlink(outputPath).catch(() => {}),
      ]);
    }
  }

  /**
   * Compress multiple audio files
   */
  async compressAudioFiles(
    audioFiles: Array<{ fileName: string; buffer: Buffer }>
  ): Promise<Array<{ fileName: string; buffer: Buffer }>> {
    const results = await Promise.all(
      audioFiles.map((file) => this.compressAudio(file.buffer, file.fileName))
    );

    return results.map((result) => ({
      fileName: result.fileName,
      buffer: result.buffer,
    }));
  }

  /**
   * Encode audio to Opus/WebM format with 320kbps bitrate
   */
  private async encodeToOpus(inputPath: string, outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libopus')
        .audioBitrate('320k') // 320kbps as requested
        .audioChannels(2)
        .format('webm') // WebM container for Opus (browser-compatible)
        .outputOptions(['-vbr', 'on'])
        .on('end', () => resolve())
        .on('error', (error: Error) => {
          loggingService.logError(error, { context: 'AudioCompressionService', inputPath, outputPath });
          reject(error);
        })
        .save(outputPath);
    });
  }

  /**
   * Get file extension from filename
   */
  private getExtension(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    // Default to wav if no extension or unknown extension
    return ext || 'wav';
  }
}

export const audioCompressionService = new AudioCompressionService();

