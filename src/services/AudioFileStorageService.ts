import { promises as fs } from 'fs';
import { join, extname, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AudioFileRecord,
  UploadAudioFileRequest,
  StorageConfig,
} from '../types/daw';
import { DEFAULT_STORAGE_CONFIG } from '../types/daw';
import { ProjectStateManager } from './ProjectStateManager';
import { loggingService } from './LoggingService';

/**
 * Audio File Storage Service handles audio file upload, storage, and metadata management
 */
export class AudioFileStorageService {
  private static instance: AudioFileStorageService;
  private config: StorageConfig;
  private projectStateManager: ProjectStateManager;

  private constructor(config: StorageConfig = DEFAULT_STORAGE_CONFIG) {
    this.config = config;
    this.projectStateManager = ProjectStateManager.getInstance();
  }

  static getInstance(config?: StorageConfig): AudioFileStorageService {
    if (!AudioFileStorageService.instance) {
      AudioFileStorageService.instance = new AudioFileStorageService(config);
    }
    return AudioFileStorageService.instance;
  }

  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      await fs.mkdir(this.config.audioFilesPath, { recursive: true });
      
      // Create subdirectories for organization
      await fs.mkdir(join(this.config.audioFilesPath, 'uploads'), { recursive: true });
      await fs.mkdir(join(this.config.audioFilesPath, 'processed'), { recursive: true });
      await fs.mkdir(join(this.config.audioFilesPath, 'temp'), { recursive: true });

      loggingService.logInfo('AudioFileStorageService initialized', { 
        storagePath: this.config.audioFilesPath 
      });
    } catch (error) {
      loggingService.logError('Failed to initialize AudioFileStorageService', { error });
      throw error;
    }
  }

  // ============================================================================
  // File Upload Operations
  // ============================================================================

  async uploadAudioFile(request: UploadAudioFileRequest, userId: string): Promise<AudioFileRecord> {
    try {
      // Validate file
      this.validateAudioFile(request);

      // Generate unique filename
      const fileExtension = extname(request.filename).toLowerCase();
      const uniqueFilename = `${uuidv4()}${fileExtension}`;
      const storagePath = join(this.config.audioFilesPath, 'uploads', uniqueFilename);

      // Save file to storage
      await fs.writeFile(storagePath, request.file);

      // Analyze audio file
      const audioMetadata = await this.analyzeAudioFile(storagePath, request.file);

      // Create audio file record
      const audioFileData: Omit<AudioFileRecord, 'id' | 'uploadedAt'> = {
        projectId: request.projectId,
        filename: uniqueFilename,
        originalName: request.originalName,
        size: request.file.length,
        duration: audioMetadata.duration,
        sampleRate: audioMetadata.sampleRate,
        channels: audioMetadata.channels,
        format: request.format,
        storagePath,
        url: this.generateFileUrl(uniqueFilename),
        uploadedBy: userId,
        processed: false,
      };

      // Save to database
      const audioFile = await this.projectStateManager.createAudioFile(audioFileData);

      // Process audio file asynchronously
      this.processAudioFileAsync(audioFile.id, storagePath);

      loggingService.logInfo('Audio file uploaded', {
        audioFileId: audioFile.id,
        projectId: request.projectId,
        filename: request.originalName,
        size: request.file.length,
        userId,
      });

      return audioFile;
    } catch (error) {
      loggingService.logError('Failed to upload audio file', {
        projectId: request.projectId,
        filename: request.originalName,
        userId,
        error,
      });
      throw error;
    }
  }

  // ============================================================================
  // File Retrieval Operations
  // ============================================================================

  async getAudioFile(audioFileId: string): Promise<Buffer | null> {
    try {
      const audioFileRecord = await this.projectStateManager.getDatabase().getAudioFile(audioFileId);
      if (!audioFileRecord) {
        return null;
      }

      const fileBuffer = await fs.readFile(audioFileRecord.storagePath);
      return fileBuffer;
    } catch (error) {
      loggingService.logError('Failed to get audio file', { audioFileId, error });
      return null;
    }
  }

  async getAudioFileMetadata(audioFileId: string): Promise<AudioFileRecord | null> {
    return this.projectStateManager.getDatabase().getAudioFile(audioFileId);
  }

  async getAudioFilesByProject(projectId: string): Promise<AudioFileRecord[]> {
    return this.projectStateManager.getAudioFilesByProject(projectId);
  }

  // ============================================================================
  // File Processing Operations
  // ============================================================================

  private async processAudioFileAsync(audioFileId: string, filePath: string): Promise<void> {
    try {
      // Generate waveform data
      const waveformData = await this.generateWaveformData(filePath);
      
      // Generate peak data for visualization
      const peakData = await this.generatePeakData(filePath);

      // Update audio file record with processed data
      await this.projectStateManager.getDatabase().updateAudioFile(audioFileId, {
        processed: true,
        waveformData,
        peakData,
      });

      loggingService.logInfo('Audio file processed', { audioFileId });
    } catch (error) {
      loggingService.logError('Failed to process audio file', { audioFileId, error });
    }
  }

  private async generateWaveformData(filePath: string): Promise<number[]> {
    // Simplified waveform generation - in a real implementation,
    // you would use a library like node-ffmpeg or similar
    try {
      const fileBuffer = await fs.readFile(filePath);
      const samples = this.extractAudioSamples(fileBuffer);
      return this.downsampleForWaveform(samples, this.config.waveformResolution);
    } catch (error) {
      loggingService.logError('Failed to generate waveform data', { filePath, error });
      return [];
    }
  }

  private async generatePeakData(filePath: string): Promise<number[]> {
    // Simplified peak data generation
    try {
      const fileBuffer = await fs.readFile(filePath);
      const samples = this.extractAudioSamples(fileBuffer);
      return this.calculatePeaks(samples, this.config.peakDataResolution);
    } catch (error) {
      loggingService.logError('Failed to generate peak data', { filePath, error });
      return [];
    }
  }

  // ============================================================================
  // File Validation
  // ============================================================================

  private validateAudioFile(request: UploadAudioFileRequest): void {
    // Check file size
    if (request.file.length > this.config.maxFileSize) {
      throw new Error(`File size exceeds maximum allowed size of ${this.config.maxFileSize} bytes`);
    }

    // Check file format
    const fileExtension = extname(request.filename).toLowerCase().substring(1);
    if (!this.config.allowedFormats.includes(fileExtension)) {
      throw new Error(`File format '${fileExtension}' is not supported. Allowed formats: ${this.config.allowedFormats.join(', ')}`);
    }

    // Basic file validation
    if (request.file.length === 0) {
      throw new Error('File is empty');
    }
  }

  // ============================================================================
  // Audio Analysis (Simplified)
  // ============================================================================

  private async analyzeAudioFile(filePath: string, fileBuffer: Buffer): Promise<{
    duration: number;
    sampleRate: number;
    channels: number;
  }> {
    // Simplified audio analysis - in a real implementation,
    // you would use a proper audio analysis library
    try {
      // For now, return default values based on common audio file characteristics
      // In a real implementation, you would parse the audio file headers
      const fileExtension = extname(filePath).toLowerCase();
      
      let estimatedDuration = 0;
      let sampleRate = 44100;
      let channels = 2;

      // Basic estimation based on file size and format
      if (fileExtension === '.wav') {
        // WAV files have headers we could parse
        estimatedDuration = this.estimateWavDuration(fileBuffer);
        sampleRate = 44100; // Default, would parse from header
        channels = 2; // Default, would parse from header
      } else if (fileExtension === '.mp3') {
        // MP3 duration estimation is more complex
        estimatedDuration = this.estimateMp3Duration(fileBuffer);
        sampleRate = 44100;
        channels = 2;
      } else {
        // Default estimation for other formats
        estimatedDuration = Math.max(1, fileBuffer.length / (sampleRate * channels * 2)); // 16-bit samples
      }

      return {
        duration: estimatedDuration,
        sampleRate,
        channels,
      };
    } catch (error) {
      loggingService.logError('Failed to analyze audio file', { filePath, error });
      // Return default values if analysis fails
      return {
        duration: 60, // Default 1 minute
        sampleRate: 44100,
        channels: 2,
      };
    }
  }

  private estimateWavDuration(buffer: Buffer): number {
    try {
      // Very basic WAV header parsing
      if (buffer.length < 44) return 0;
      
      // Check for WAV signature
      if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        return 0;
      }

      // Read sample rate (bytes 24-27)
      const sampleRate = buffer.readUInt32LE(24);
      
      // Read byte rate (bytes 28-31)
      const byteRate = buffer.readUInt32LE(28);
      
      // Calculate duration
      const dataSize = buffer.length - 44; // Approximate data size
      return dataSize / byteRate;
    } catch (error) {
      return 0;
    }
  }

  private estimateMp3Duration(buffer: Buffer): number {
    // Very simplified MP3 duration estimation
    // In reality, you'd need to parse MP3 frames
    const avgBitrate = 128000; // 128 kbps average
    const fileSizeInBits = buffer.length * 8;
    return fileSizeInBits / avgBitrate;
  }

  // ============================================================================
  // Audio Processing Utilities
  // ============================================================================

  private extractAudioSamples(buffer: Buffer): number[] {
    // Simplified sample extraction - assumes 16-bit PCM
    const samples: number[] = [];
    for (let i = 44; i < buffer.length - 1; i += 2) { // Skip WAV header
      const sample = buffer.readInt16LE(i) / 32768; // Normalize to -1 to 1
      samples.push(sample);
    }
    return samples;
  }

  private downsampleForWaveform(samples: number[], targetLength: number): number[] {
    if (samples.length <= targetLength) return samples;
    
    const blockSize = Math.floor(samples.length / targetLength);
    const waveform: number[] = [];
    
    for (let i = 0; i < targetLength; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, samples.length);
      
      let max = 0;
      for (let j = start; j < end; j++) {
        max = Math.max(max, Math.abs(samples[j]));
      }
      
      waveform.push(max);
    }
    
    return waveform;
  }

  private calculatePeaks(samples: number[], targetLength: number): number[] {
    if (samples.length <= targetLength) return samples;
    
    const blockSize = Math.floor(samples.length / targetLength);
    const peaks: number[] = [];
    
    for (let i = 0; i < targetLength; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, samples.length);
      
      let peak = 0;
      for (let j = start; j < end; j++) {
        peak = Math.max(peak, Math.abs(samples[j]));
      }
      
      peaks.push(peak);
    }
    
    return peaks;
  }

  // ============================================================================
  // File Management
  // ============================================================================

  async deleteAudioFile(audioFileId: string): Promise<boolean> {
    try {
      const audioFile = await this.getAudioFileMetadata(audioFileId);
      if (!audioFile) return false;

      // Delete physical file
      try {
        await fs.unlink(audioFile.storagePath);
      } catch (error) {
        loggingService.logError('Failed to delete physical audio file', {
          audioFileId,
          storagePath: audioFile.storagePath,
          error,
        });
      }

      // Delete from database
      const success = await this.projectStateManager.getDatabase().deleteAudioFile(audioFileId);

      if (success) {
        loggingService.logInfo('Audio file deleted', { audioFileId });
      }

      return success;
    } catch (error) {
      loggingService.logError('Failed to delete audio file', { audioFileId, error });
      return false;
    }
  }

  private generateFileUrl(filename: string): string {
    // In a real implementation, this would generate a proper URL
    // that could be served by the web server or CDN
    return `/api/audio-files/${filename}`;
  }

  // ============================================================================
  // Cleanup Operations
  // ============================================================================

  async cleanupOrphanedFiles(): Promise<number> {
    try {
      const uploadsDir = join(this.config.audioFilesPath, 'uploads');
      const files = await fs.readdir(uploadsDir);
      
      let deletedCount = 0;
      
      for (const filename of files) {
        const filePath = join(uploadsDir, filename);
        
        // Check if file exists in database
        const audioFiles = await this.projectStateManager.getAudioFilesByProject(''); // Get all
        const fileExists = audioFiles.some(af => af.filename === filename);
        
        if (!fileExists) {
          try {
            await fs.unlink(filePath);
            deletedCount++;
            loggingService.logInfo('Deleted orphaned audio file', { filename });
          } catch (error) {
            loggingService.logError('Failed to delete orphaned file', { filename, error });
          }
        }
      }
      
      return deletedCount;
    } catch (error) {
      loggingService.logError('Failed to cleanup orphaned files', { error });
      return 0;
    }
  }

  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    averageFileSize: number;
    storageUsed: string;
  }> {
    try {
      const uploadsDir = join(this.config.audioFilesPath, 'uploads');
      const files = await fs.readdir(uploadsDir);
      
      let totalSize = 0;
      
      for (const filename of files) {
        const filePath = join(uploadsDir, filename);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
      
      const averageFileSize = files.length > 0 ? totalSize / files.length : 0;
      const storageUsed = this.formatBytes(totalSize);
      
      return {
        totalFiles: files.length,
        totalSize,
        averageFileSize,
        storageUsed,
      };
    } catch (error) {
      loggingService.logError('Failed to get storage stats', { error });
      return {
        totalFiles: 0,
        totalSize: 0,
        averageFileSize: 0,
        storageUsed: '0 B',
      };
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}