import { AudioFileSyncService } from '../AudioFileSyncService';
import { AudioFileStorageService } from '../AudioFileStorageService';
import { ProjectStateManager } from '../ProjectStateManager';
import { CacheService } from '../CacheService';
import type { UploadAudioFileRequest } from '../../types/daw';

// Mock dependencies
jest.mock('../AudioFileStorageService');
jest.mock('../ProjectStateManager');
jest.mock('../CacheService');
jest.mock('../LoggingService');

describe('AudioFileSyncService', () => {
  let audioFileSyncService: AudioFileSyncService;
  let mockAudioFileStorageService: jest.Mocked<AudioFileStorageService>;
  let mockProjectStateManager: jest.Mocked<ProjectStateManager>;
  let mockCacheService: jest.Mocked<CacheService>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create service instance
    audioFileSyncService = AudioFileSyncService.getInstance();

    // Get mocked instances
    mockAudioFileStorageService = AudioFileStorageService.getInstance() as jest.Mocked<AudioFileStorageService>;
    mockProjectStateManager = ProjectStateManager.getInstance() as jest.Mocked<ProjectStateManager>;
    mockCacheService = CacheService.getInstance() as jest.Mocked<CacheService>;
  });

  describe('uploadAndDistributeAudioFile', () => {
    it('should upload and distribute audio file successfully', async () => {
      // Arrange
      const mockAudioFile = {
        id: 'audio-file-1',
        projectId: 'project-1',
        filename: 'test.wav',
        originalName: 'test-audio.wav',
        size: 1024,
        duration: 10,
        sampleRate: 44100,
        channels: 2,
        format: 'wav',
        storagePath: '/path/to/file',
        url: '/api/audio-files/test.wav',
        uploadedBy: 'user-1',
        uploadedAt: new Date(),
        processed: false,
      };

      const uploadRequest: UploadAudioFileRequest = {
        projectId: 'project-1',
        file: Buffer.from('mock audio data'),
        filename: 'test.wav',
        originalName: 'test-audio.wav',
        format: 'wav',
      };

      mockAudioFileStorageService.uploadAudioFile.mockResolvedValue(mockAudioFile);

      // Act
      const result = await audioFileSyncService.uploadAndDistributeAudioFile(
        uploadRequest,
        'user-1',
        'room-1'
      );

      // Assert
      expect(result).toEqual(mockAudioFile);
      expect(mockAudioFileStorageService.uploadAudioFile).toHaveBeenCalledWith(uploadRequest, 'user-1');
    });

    it('should handle upload errors gracefully', async () => {
      // Arrange
      const uploadRequest: UploadAudioFileRequest = {
        projectId: 'project-1',
        file: Buffer.from('mock audio data'),
        filename: 'test.wav',
        originalName: 'test-audio.wav',
        format: 'wav',
      };

      mockAudioFileStorageService.uploadAudioFile.mockRejectedValue(new Error('Upload failed'));

      // Act & Assert
      await expect(
        audioFileSyncService.uploadAndDistributeAudioFile(uploadRequest, 'user-1', 'room-1')
      ).rejects.toThrow('Upload failed');
    });
  });

  describe('distributeAudioFilesToNewUser', () => {
    it('should distribute audio files to new user', async () => {
      // Arrange
      const mockProjects = [
        { id: 'project-1', roomId: 'room-1', name: 'Test Project' },
      ];

      const mockAudioFiles = [
        {
          id: 'audio-file-1',
          projectId: 'project-1',
          filename: 'test1.wav',
          originalName: 'test1.wav',
          size: 1024,
          duration: 10,
          sampleRate: 44100,
          channels: 2,
          format: 'wav',
          storagePath: '/path/to/file1',
          url: '/api/audio-files/test1.wav',
          uploadedBy: 'user-1',
          uploadedAt: new Date(),
          processed: true,
        },
        {
          id: 'audio-file-2',
          projectId: 'project-1',
          filename: 'test2.wav',
          originalName: 'test2.wav',
          size: 2048,
          duration: 20,
          sampleRate: 44100,
          channels: 2,
          format: 'wav',
          storagePath: '/path/to/file2',
          url: '/api/audio-files/test2.wav',
          uploadedBy: 'user-2',
          uploadedAt: new Date(),
          processed: true,
        },
      ];

      mockProjectStateManager.getProjectsByRoom.mockResolvedValue(mockProjects as any);
      mockAudioFileStorageService.getAudioFilesByProject.mockResolvedValue(mockAudioFiles as any);
      mockAudioFileStorageService.getAudioFile.mockResolvedValue(Buffer.from('mock audio data'));

      // Act
      await audioFileSyncService.distributeAudioFilesToNewUser('user-3', 'room-1');

      // Assert
      expect(mockProjectStateManager.getProjectsByRoom).toHaveBeenCalledWith('room-1');
      expect(mockAudioFileStorageService.getAudioFilesByProject).toHaveBeenCalledWith('project-1');
    });

    it('should handle empty room gracefully', async () => {
      // Arrange
      mockProjectStateManager.getProjectsByRoom.mockResolvedValue([]);

      // Act
      await audioFileSyncService.distributeAudioFilesToNewUser('user-3', 'room-1');

      // Assert
      expect(mockProjectStateManager.getProjectsByRoom).toHaveBeenCalledWith('room-1');
      expect(mockAudioFileStorageService.getAudioFilesByProject).not.toHaveBeenCalled();
    });
  });

  describe('verifyAudioFileIntegrity', () => {
    it('should verify audio file integrity successfully', async () => {
      // Arrange
      const mockMetadata = {
        fileHash: 'abc123',
        compressed: false,
        compressedSize: 0,
        distributedAt: new Date(),
      };

      mockCacheService.get.mockReturnValue(mockMetadata);

      // Act
      const result = await audioFileSyncService.verifyAudioFileIntegrity('audio-file-1', 'abc123');

      // Assert
      expect(result).toEqual({
        isValid: true,
        serverHash: 'abc123',
      });
    });

    it('should detect hash mismatch', async () => {
      // Arrange
      const mockMetadata = {
        fileHash: 'abc123',
        compressed: false,
        compressedSize: 0,
        distributedAt: new Date(),
      };

      mockCacheService.get.mockReturnValue(mockMetadata);

      // Act
      const result = await audioFileSyncService.verifyAudioFileIntegrity('audio-file-1', 'def456');

      // Assert
      expect(result).toEqual({
        isValid: false,
        serverHash: 'abc123',
      });
    });

    it('should handle missing metadata', async () => {
      // Arrange
      mockCacheService.get.mockReturnValue(null);

      // Act
      const result = await audioFileSyncService.verifyAudioFileIntegrity('audio-file-1', 'abc123');

      // Assert
      expect(result).toEqual({
        isValid: false,
      });
    });
  });

  describe('preloadAudioFilesForProject', () => {
    it('should preload audio files with high priority', async () => {
      // Arrange
      const mockAudioFiles = [
        {
          id: 'audio-file-1',
          projectId: 'project-1',
          size: 1024 * 1024, // 1MB
          uploadedAt: new Date(),
        },
        {
          id: 'audio-file-2',
          projectId: 'project-1',
          size: 10 * 1024 * 1024, // 10MB
          uploadedAt: new Date(),
        },
      ];

      mockAudioFileStorageService.getAudioFilesByProject.mockResolvedValue(mockAudioFiles as any);
      mockAudioFileStorageService.getAudioFile.mockResolvedValue(Buffer.from('mock audio data'));
      mockCacheService.get.mockReturnValue(null); // Not cached

      // Act
      await audioFileSyncService.preloadAudioFilesForProject('project-1', 'user-1', 'high');

      // Assert
      expect(mockAudioFileStorageService.getAudioFilesByProject).toHaveBeenCalledWith('project-1');
      // Should only preload the smaller file (< 5MB) for high priority
      expect(mockAudioFileStorageService.getAudioFile).toHaveBeenCalledWith('audio-file-1');
      expect(mockAudioFileStorageService.getAudioFile).not.toHaveBeenCalledWith('audio-file-2');
    });

    it('should handle empty project', async () => {
      // Arrange
      mockAudioFileStorageService.getAudioFilesByProject.mockResolvedValue([]);

      // Act
      await audioFileSyncService.preloadAudioFilesForProject('project-1', 'user-1', 'medium');

      // Assert
      expect(mockAudioFileStorageService.getAudioFilesByProject).toHaveBeenCalledWith('project-1');
      expect(mockAudioFileStorageService.getAudioFile).not.toHaveBeenCalled();
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      // Act
      const stats = await audioFileSyncService.getCacheStats();

      // Assert
      expect(stats).toHaveProperty('cachedFiles');
      expect(stats).toHaveProperty('compressedFiles');
      expect(stats).toHaveProperty('totalCacheSize');
      expect(stats).toHaveProperty('totalCompressedSize');
      expect(typeof stats.cachedFiles).toBe('number');
      expect(typeof stats.compressedFiles).toBe('number');
      expect(typeof stats.totalCacheSize).toBe('number');
      expect(typeof stats.totalCompressedSize).toBe('number');
    });
  });

  describe('clearAudioFileCache', () => {
    it('should clear specific audio file cache', async () => {
      // Act
      await audioFileSyncService.clearAudioFileCache('audio-file-1');

      // Assert
      expect(mockCacheService.del).toHaveBeenCalledWith('audio_file:audio-file-1');
      expect(mockCacheService.del).toHaveBeenCalledWith('audio_sync_metadata:audio-file-1');
    });

    it('should clear all audio file caches when no ID provided', async () => {
      // Act
      await audioFileSyncService.clearAudioFileCache();

      // Assert - Should not call del with specific keys when clearing all
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });
});