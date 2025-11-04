import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import type {
  AudioFileRecord,
  UploadAudioFileRequest,
} from '../types/daw';
import { AudioFileStorageService } from './AudioFileStorageService';
import { ProjectStateManager } from './ProjectStateManager';
import { CacheService } from './CacheService';
import { loggingService } from './LoggingService';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Audio File Synchronization Service
 * Handles automatic distribution of audio files to new users and caching
 */
export class AudioFileSyncService extends EventEmitter {
  private static instance: AudioFileSyncService;
  private audioFileStorageService: AudioFileStorageService;
  private projectStateManager: ProjectStateManager;
  private cacheService: CacheService;
  private compressionCache = new Map<string, Buffer>();
  private readonly COMPRESSION_THRESHOLD = 1024 * 1024; // 1MB
  private readonly CHUNK_SIZE = 64 * 1024; // 64KB chunks for streaming
  private readonly CACHE_TTL = 3600; // 1 hour cache TTL

  private constructor() {
    super();
    this.audioFileStorageService = AudioFileStorageService.getInstance();
    this.projectStateManager = ProjectStateManager.getInstance();
    this.cacheService = CacheService.getInstance();
  }

  static getInstance(): AudioFileSyncService {
    if (!AudioFileSyncService.instance) {
      AudioFileSyncService.instance = new AudioFileSyncService();
    }
    return AudioFileSyncService.instance;
  }

  async initialize(): Promise<void> {
    await this.audioFileStorageService.initialize();
    loggingService.logInfo('AudioFileSyncService initialized');
  }

  // ============================================================================
  // Enhanced Audio File Upload with Automatic Distribution
  // ============================================================================

  async uploadAndDistributeAudioFile(
    request: UploadAudioFileRequest,
    userId: string,
    roomId: string
  ): Promise<AudioFileRecord> {
    try {
      // Upload the file using existing storage service
      const audioFile = await this.audioFileStorageService.uploadAudioFile(request, userId);

      // Generate file hash for integrity checking
      const fileHash = await this.generateFileHash(request.file);
      
      // Compress file for faster distribution if it's large enough
      let compressedBuffer: Buffer | null = null;
      if (request.file.length > this.COMPRESSION_THRESHOLD) {
        compressedBuffer = await this.compressAudioFile(request.file);
        this.compressionCache.set(audioFile.id, compressedBuffer);
      }

      // Cache the original file for quick access
      await this.cacheAudioFile(audioFile.id, request.file, fileHash);

      // Distribute to all users in the room
      await this.distributeAudioFileToRoom(audioFile, roomId, userId);

      // Update audio file record with sync metadata
      await this.updateAudioFileWithSyncMetadata(audioFile.id, {
        fileHash,
        compressed: compressedBuffer !== null,
        compressedSize: compressedBuffer?.length || 0,
        distributedAt: new Date(),
      });

      loggingService.logInfo('Audio file uploaded and distributed', {
        audioFileId: audioFile.id,
        projectId: request.projectId,
        roomId,
        userId,
        originalSize: request.file.length,
        compressedSize: compressedBuffer?.length || 0,
        compressed: compressedBuffer !== null,
      });

      return audioFile;
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to upload and distribute audio file'), {
        projectId: request.projectId,
        roomId,
        userId,
        error,
      });
      throw error;
    }
  }

  // ============================================================================
  // Automatic Audio File Distribution to New Users
  // ============================================================================

  async distributeAudioFilesToNewUser(userId: string, roomId: string): Promise<void> {
    try {
      // Get all projects in the room
      const projects = await this.projectStateManager.getProjectsByRoom(roomId);
      
      if (projects.length === 0) {
        loggingService.logInfo('No projects found for audio file distribution', { userId, roomId });
        return;
      }

      // Get all audio files for all projects in the room
      const allAudioFiles: AudioFileRecord[] = [];
      for (const project of projects) {
        const audioFiles = await this.audioFileStorageService.getAudioFilesByProject(project.id);
        allAudioFiles.push(...audioFiles);
      }

      if (allAudioFiles.length === 0) {
        loggingService.logInfo('No audio files found for distribution', { userId, roomId });
        return;
      }

      // Sort by priority (smaller files first, then by upload date)
      const prioritizedFiles = this.prioritizeAudioFilesForDistribution(allAudioFiles);

      // Distribute files in batches
      await this.distributeAudioFilesBatch(userId, prioritizedFiles);

      loggingService.logInfo('Audio files distributed to new user', {
        userId,
        roomId,
        fileCount: allAudioFiles.length,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to distribute audio files to new user'), {
        userId,
        roomId,
        error,
      });
      throw error;
    }
  }

  private async distributeAudioFilesBatch(
    userId: string,
    audioFiles: AudioFileRecord[]
  ): Promise<void> {
    const batchSize = 5; // Process 5 files at a time
    
    for (let i = 0; i < audioFiles.length; i += batchSize) {
      const batch = audioFiles.slice(i, i + batchSize);
      
      // Process batch in parallel
      const distributionPromises = batch.map(audioFile => 
        this.distributeAudioFileToUser(audioFile, userId)
      );

      await Promise.allSettled(distributionPromises);

      // Small delay between batches to prevent overwhelming
      if (i + batchSize < audioFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  private async distributeAudioFileToUser(
    audioFile: AudioFileRecord,
    userId: string
  ): Promise<void> {
    try {
      // Check if file is cached and compressed
      let fileBuffer = await this.getCachedAudioFile(audioFile.id);
      let isCompressed = false;

      if (!fileBuffer) {
        // Get original file
        fileBuffer = await this.audioFileStorageService.getAudioFile(audioFile.id);
        if (!fileBuffer) {
          throw new Error(`Audio file not found: ${audioFile.id}`);
        }
      }

      // Check if we have a compressed version
      const compressedBuffer = this.compressionCache.get(audioFile.id);
      if (compressedBuffer && compressedBuffer.length < fileBuffer.length * 0.8) {
        fileBuffer = compressedBuffer;
        isCompressed = true;
      }

      // Send file metadata first
      this.emit('distribute_audio_metadata', {
        userId,
        audioFile: {
          ...audioFile,
          isCompressed,
          transferSize: fileBuffer.length,
        },
        timestamp: new Date(),
      });

      // Send file in chunks for large files
      if (fileBuffer.length > this.CHUNK_SIZE) {
        await this.sendAudioFileInChunks(userId, audioFile.id, fileBuffer, isCompressed);
      } else {
        // Send small files directly
        this.emit('distribute_audio_file', {
          userId,
          audioFileId: audioFile.id,
          buffer: fileBuffer,
          isCompressed,
          isComplete: true,
          timestamp: new Date(),
        });
      }

      loggingService.logInfo('Audio file distributed to user', {
        userId,
        audioFileId: audioFile.id,
        size: fileBuffer.length,
        isCompressed,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to distribute audio file to user'), {
        userId,
        audioFileId: audioFile.id,
        error,
      });
    }
  }

  private async sendAudioFileInChunks(
    userId: string,
    audioFileId: string,
    buffer: Buffer,
    isCompressed: boolean
  ): Promise<void> {
    const totalChunks = Math.ceil(buffer.length / this.CHUNK_SIZE);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, buffer.length);
      const chunk = buffer.slice(start, end);
      const isLastChunk = i === totalChunks - 1;

      this.emit('distribute_audio_chunk', {
        userId,
        audioFileId,
        chunkIndex: i,
        totalChunks,
        chunk,
        isCompressed,
        isComplete: isLastChunk,
        timestamp: new Date(),
      });

      // Small delay between chunks
      if (!isLastChunk) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  // ============================================================================
  // Audio File Caching and Compression
  // ============================================================================

  private async compressAudioFile(buffer: Buffer): Promise<Buffer> {
    try {
      const compressed = await gzipAsync(buffer);
      const compressionRatio = compressed.length / buffer.length;
      
      loggingService.logInfo('Audio file compressed', {
        originalSize: buffer.length,
        compressedSize: compressed.length,
        compressionRatio: compressionRatio.toFixed(2),
      });

      return compressed;
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to compress audio file'), {});
      return buffer; // Return original if compression fails
    }
  }

  async decompressAudioFile(compressedBuffer: Buffer): Promise<Buffer> {
    try {
      return await gunzipAsync(compressedBuffer);
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to decompress audio file'), {});
      throw error;
    }
  }

  private async cacheAudioFile(
    audioFileId: string,
    buffer: Buffer,
    fileHash: string
  ): Promise<void> {
    const cacheKey = `audio_file:${audioFileId}`;
    const cacheData = {
      buffer,
      hash: fileHash,
      cachedAt: new Date(),
    };

    this.cacheService.set(cacheKey, cacheData, this.CACHE_TTL);
  }

  private async getCachedAudioFile(audioFileId: string): Promise<Buffer | null> {
    const cacheKey = `audio_file:${audioFileId}`;
    const cached = this.cacheService.get<{
      buffer: Buffer;
      hash: string;
      cachedAt: Date;
    }>(cacheKey);

    return cached?.buffer || null;
  }

  async getAudioFile(audioFileId: string): Promise<Buffer | null> {
    // Try cache first
    let fileBuffer = await this.getCachedAudioFile(audioFileId);
    
    if (!fileBuffer) {
      // Get from storage service
      fileBuffer = await this.audioFileStorageService.getAudioFile(audioFileId);
    }
    
    return fileBuffer;
  }

  // ============================================================================
  // Audio File Metadata Tracking and Management
  // ============================================================================

  private async updateAudioFileWithSyncMetadata(
    audioFileId: string,
    metadata: {
      fileHash: string;
      compressed: boolean;
      compressedSize: number;
      distributedAt: Date;
    }
  ): Promise<void> {
    try {
      // Store sync metadata in cache for quick access
      const metadataKey = `audio_sync_metadata:${audioFileId}`;
      this.cacheService.set(metadataKey, metadata, this.CACHE_TTL * 2); // Longer TTL for metadata

      loggingService.logInfo('Audio file sync metadata updated', {
        audioFileId,
        metadata,
      });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to update audio file sync metadata'), {
        audioFileId,
        error,
      });
    }
  }

  async getAudioFileSyncMetadata(audioFileId: string): Promise<{
    fileHash: string;
    compressed: boolean;
    compressedSize: number;
    distributedAt: Date;
  } | null> {
    const metadataKey = `audio_sync_metadata:${audioFileId}`;
    return this.cacheService.get(metadataKey) || null;
  }

  private async generateFileHash(buffer: Buffer): Promise<string> {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async verifyAudioFileIntegrity(
    audioFileId: string,
    clientHash: string
  ): Promise<{ isValid: boolean; serverHash?: string }> {
    try {
      const metadata = await this.getAudioFileSyncMetadata(audioFileId);
      if (!metadata) {
        return { isValid: false };
      }

      const isValid = metadata.fileHash === clientHash;
      return {
        isValid,
        serverHash: metadata.fileHash,
      };
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to verify audio file integrity'), {
        audioFileId,
        error,
      });
      return { isValid: false };
    }
  }

  // ============================================================================
  // Room-wide Audio File Distribution
  // ============================================================================

  private async distributeAudioFileToRoom(
    audioFile: AudioFileRecord,
    roomId: string,
    uploaderUserId: string
  ): Promise<void> {
    try {
      // Emit event for real-time distribution to all users in room
      this.emit('distribute_to_room', {
        roomId,
        audioFile,
        uploaderUserId,
        timestamp: new Date(),
      });

      loggingService.logInfo('Audio file distribution initiated for room', {
        audioFileId: audioFile.id,
        roomId,
        uploaderUserId,
      });
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to distribute audio file to room'), {
        audioFileId: audioFile.id,
        roomId,
        error,
      });
    }
  }

  // ============================================================================
  // Audio File Prioritization for Distribution
  // ============================================================================

  private prioritizeAudioFilesForDistribution(audioFiles: AudioFileRecord[]): AudioFileRecord[] {
    return audioFiles.sort((a, b) => {
      // Prioritize smaller files first for faster initial loading
      if (a.size !== b.size) {
        return a.size - b.size;
      }

      // Then prioritize more recently uploaded files
      return b.uploadedAt.getTime() - a.uploadedAt.getTime();
    });
  }

  // ============================================================================
  // Batch Operations for Performance
  // ============================================================================

  async preloadAudioFilesForProject(
    projectId: string,
    userId: string,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<void> {
    try {
      const audioFiles = await this.audioFileStorageService.getAudioFilesByProject(projectId);
      
      if (audioFiles.length === 0) {
        return;
      }

      // Filter and prioritize based on priority level
      let filesToPreload = audioFiles;
      
      if (priority === 'high') {
        // Only preload small, recently used files
        filesToPreload = audioFiles
          .filter(af => af.size < 5 * 1024 * 1024) // < 5MB
          .slice(0, 5); // Top 5 files
      } else if (priority === 'low') {
        // Preload larger files in background
        filesToPreload = audioFiles
          .filter(af => af.size >= 5 * 1024 * 1024) // >= 5MB
          .slice(0, 3); // Top 3 large files
      }

      // Preload files asynchronously
      const preloadPromises = filesToPreload.map(audioFile =>
        this.preloadAudioFileAsync(audioFile, userId)
      );

      await Promise.allSettled(preloadPromises);

      loggingService.logInfo('Audio files preloaded for project', {
        projectId,
        userId,
        priority,
        fileCount: filesToPreload.length,
      });

    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to preload audio files for project'), {
        projectId,
        userId,
        priority,
        error,
      });
    }
  }

  private async preloadAudioFileAsync(
    audioFile: AudioFileRecord,
    userId: string
  ): Promise<void> {
    try {
      // Check if already cached
      const cached = await this.getCachedAudioFile(audioFile.id);
      if (cached) {
        return; // Already cached
      }

      // Load and cache the file
      const fileBuffer = await this.audioFileStorageService.getAudioFile(audioFile.id);
      if (fileBuffer) {
        const fileHash = await this.generateFileHash(fileBuffer);
        await this.cacheAudioFile(audioFile.id, fileBuffer, fileHash);

        // Emit preload event
        this.emit('audio_file_preloaded', {
          userId,
          audioFileId: audioFile.id,
          size: fileBuffer.length,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      loggingService.logError(error instanceof Error ? error : new Error('Failed to preload audio file'), {
        audioFileId: audioFile.id,
        userId,
        error,
      });
    }
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  async clearAudioFileCache(audioFileId?: string): Promise<void> {
    if (audioFileId) {
      // Clear specific file cache
      this.cacheService.del(`audio_file:${audioFileId}`);
      this.cacheService.del(`audio_sync_metadata:${audioFileId}`);
      this.compressionCache.delete(audioFileId);
      
      loggingService.logInfo('Audio file cache cleared', { audioFileId });
    } else {
      // Clear all audio file caches
      this.compressionCache.clear();
      
      loggingService.logInfo('All audio file caches cleared');
    }
  }

  async getCacheStats(): Promise<{
    cachedFiles: number;
    compressedFiles: number;
    totalCacheSize: number;
    totalCompressedSize: number;
  }> {
    const totalCacheSize = 0;
    const cachedFiles = 0;
    
    // Note: This is a simplified implementation
    // In a real system, you'd iterate through cache keys
    
    let totalCompressedSize = 0;
    for (const buffer of this.compressionCache.values()) {
      totalCompressedSize += buffer.length;
    }

    return {
      cachedFiles,
      compressedFiles: this.compressionCache.size,
      totalCacheSize,
      totalCompressedSize,
    };
  }

  // ============================================================================
  // Cleanup Operations
  // ============================================================================

  async cleanup(): Promise<void> {
    // Clear compression cache
    this.compressionCache.clear();
    
    loggingService.logInfo('AudioFileSyncService cleanup completed');
  }
}