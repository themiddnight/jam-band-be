import { Socket, Namespace } from 'socket.io';
import { AudioFileSyncService } from '../services/AudioFileSyncService';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { loggingService } from '../services/LoggingService';

/**
 * Audio File Synchronization Handlers
 * Handles real-time audio file distribution via WebRTC and Socket.IO
 */
export class AudioFileSyncHandlers {
  private audioFileSyncService: AudioFileSyncService;
  private projectStateManager: ProjectStateManager;

  constructor() {
    this.audioFileSyncService = AudioFileSyncService.getInstance();
    this.projectStateManager = ProjectStateManager.getInstance();
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to audio file sync service events
    this.audioFileSyncService.on('distribute_to_room', this.handleDistributeToRoom.bind(this));
    this.audioFileSyncService.on('distribute_audio_metadata', this.handleDistributeAudioMetadata.bind(this));
    this.audioFileSyncService.on('distribute_audio_file', this.handleDistributeAudioFile.bind(this));
    this.audioFileSyncService.on('distribute_audio_chunk', this.handleDistributeAudioChunk.bind(this));
    this.audioFileSyncService.on('audio_file_preloaded', this.handleAudioFilePreloaded.bind(this));
  }

  // ============================================================================
  // Socket.IO Event Handlers
  // ============================================================================

  setupSocketHandlers(socket: Socket, namespace: Namespace): void {
    // Request audio file distribution for new user
    socket.on('request_audio_files', async (data: { roomId: string }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        await this.audioFileSyncService.distributeAudioFilesToNewUser(userId, data.roomId);
        
        loggingService.logInfo('Audio file distribution requested', {
          userId,
          roomId: data.roomId,
          socketId: socket.id,
        });

      } catch (error) {
        loggingService.logError('Failed to handle audio file distribution request', {
          userId: socket.data.userId,
          roomId: data.roomId,
          error,
        });
        socket.emit('error', { message: 'Failed to distribute audio files' });
      }
    });

    // Request specific audio file
    socket.on('request_audio_file', async (data: { audioFileId: string; compressed?: boolean }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        await this.handleAudioFileRequest(socket, data.audioFileId, data.compressed || false);

      } catch (error) {
        loggingService.logError('Failed to handle audio file request', {
          userId: socket.data.userId,
          audioFileId: data.audioFileId,
          error,
        });
        socket.emit('error', { message: 'Failed to get audio file' });
      }
    });

    // Verify audio file integrity
    socket.on('verify_audio_file', async (data: { audioFileId: string; clientHash: string }) => {
      try {
        const result = await this.audioFileSyncService.verifyAudioFileIntegrity(
          data.audioFileId,
          data.clientHash
        );

        socket.emit('audio_file_verification_result', {
          audioFileId: data.audioFileId,
          ...result,
        });

      } catch (error) {
        loggingService.logError('Failed to verify audio file integrity', {
          audioFileId: data.audioFileId,
          error,
        });
        socket.emit('error', { message: 'Failed to verify audio file integrity' });
      }
    });

    // Request audio file preloading
    socket.on('preload_audio_files', async (data: { projectId: string; priority?: string }) => {
      try {
        const userId = socket.data.userId;
        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        const priority = data.priority as 'high' | 'medium' | 'low' || 'medium';
        await this.audioFileSyncService.preloadAudioFilesForProject(data.projectId, userId, priority);

        socket.emit('preload_initiated', {
          projectId: data.projectId,
          priority,
        });

      } catch (error) {
        loggingService.logError('Failed to handle audio file preload request', {
          userId: socket.data.userId,
          projectId: data.projectId,
          error,
        });
        socket.emit('error', { message: 'Failed to preload audio files' });
      }
    });

    // Report audio file sync status
    socket.on('audio_file_sync_status', (data: { 
      audioFileId: string; 
      status: 'received' | 'cached' | 'error';
      error?: string;
    }) => {
      loggingService.logInfo('Audio file sync status reported', {
        userId: socket.data.userId,
        audioFileId: data.audioFileId,
        status: data.status,
        error: data.error,
      });

      // Emit status to room for monitoring
      if (socket.data.roomId) {
        namespace.to(socket.data.roomId).emit('audio_file_sync_status_update', {
          userId: socket.data.userId,
          audioFileId: data.audioFileId,
          status: data.status,
          timestamp: new Date(),
        });
      }
    });
  }

  // ============================================================================
  // Audio File Distribution Event Handlers
  // ============================================================================

  private async handleDistributeToRoom(data: {
    roomId: string;
    audioFile: any;
    uploaderUserId: string;
    timestamp: Date;
  }): Promise<void> {
    try {
      // Get namespace for the room
      const namespace = this.getNamespaceForRoom(data.roomId);
      if (!namespace) return;

      // Notify all users in room about new audio file
      namespace.to(data.roomId).emit('new_audio_file_uploaded', {
        audioFile: data.audioFile,
        uploaderUserId: data.uploaderUserId,
        timestamp: data.timestamp,
      });

      loggingService.logInfo('Audio file upload notification sent to room', {
        roomId: data.roomId,
        audioFileId: data.audioFile.id,
        uploaderUserId: data.uploaderUserId,
      });

    } catch (error) {
      loggingService.logError('Failed to handle distribute to room event', {
        roomId: data.roomId,
        audioFileId: data.audioFile.id,
        error,
      });
    }
  }

  private async handleDistributeAudioMetadata(data: {
    userId: string;
    audioFile: any;
    timestamp: Date;
  }): Promise<void> {
    try {
      const socket = this.getSocketForUser(data.userId);
      if (!socket) return;

      socket.emit('audio_file_metadata', {
        audioFile: data.audioFile,
        timestamp: data.timestamp,
      });

      loggingService.logInfo('Audio file metadata sent to user', {
        userId: data.userId,
        audioFileId: data.audioFile.id,
      });

    } catch (error) {
      loggingService.logError('Failed to handle distribute audio metadata event', {
        userId: data.userId,
        audioFileId: data.audioFile.id,
        error,
      });
    }
  }

  private async handleDistributeAudioFile(data: {
    userId: string;
    audioFileId: string;
    buffer: Buffer;
    isCompressed: boolean;
    isComplete: boolean;
    timestamp: Date;
  }): Promise<void> {
    try {
      const socket = this.getSocketForUser(data.userId);
      if (!socket) return;

      // Convert buffer to base64 for transmission
      const base64Data = data.buffer.toString('base64');

      socket.emit('audio_file_data', {
        audioFileId: data.audioFileId,
        data: base64Data,
        isCompressed: data.isCompressed,
        isComplete: data.isComplete,
        size: data.buffer.length,
        timestamp: data.timestamp,
      });

      loggingService.logInfo('Audio file data sent to user', {
        userId: data.userId,
        audioFileId: data.audioFileId,
        size: data.buffer.length,
        isCompressed: data.isCompressed,
        isComplete: data.isComplete,
      });

    } catch (error) {
      loggingService.logError('Failed to handle distribute audio file event', {
        userId: data.userId,
        audioFileId: data.audioFileId,
        error,
      });
    }
  }

  private async handleDistributeAudioChunk(data: {
    userId: string;
    audioFileId: string;
    chunkIndex: number;
    totalChunks: number;
    chunk: Buffer;
    isCompressed: boolean;
    isComplete: boolean;
    timestamp: Date;
  }): Promise<void> {
    try {
      const socket = this.getSocketForUser(data.userId);
      if (!socket) return;

      // Convert chunk to base64 for transmission
      const base64Chunk = data.chunk.toString('base64');

      socket.emit('audio_file_chunk', {
        audioFileId: data.audioFileId,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        data: base64Chunk,
        isCompressed: data.isCompressed,
        isComplete: data.isComplete,
        size: data.chunk.length,
        timestamp: data.timestamp,
      });

      loggingService.logInfo('Audio file chunk sent to user', {
        userId: data.userId,
        audioFileId: data.audioFileId,
        chunkIndex: data.chunkIndex,
        totalChunks: data.totalChunks,
        size: data.chunk.length,
      });

    } catch (error) {
      loggingService.logError('Failed to handle distribute audio chunk event', {
        userId: data.userId,
        audioFileId: data.audioFileId,
        chunkIndex: data.chunkIndex,
        error,
      });
    }
  }

  private async handleAudioFilePreloaded(data: {
    userId: string;
    audioFileId: string;
    size: number;
    timestamp: Date;
  }): Promise<void> {
    try {
      const socket = this.getSocketForUser(data.userId);
      if (!socket) return;

      socket.emit('audio_file_preloaded', {
        audioFileId: data.audioFileId,
        size: data.size,
        timestamp: data.timestamp,
      });

      loggingService.logInfo('Audio file preload notification sent to user', {
        userId: data.userId,
        audioFileId: data.audioFileId,
        size: data.size,
      });

    } catch (error) {
      loggingService.logError('Failed to handle audio file preloaded event', {
        userId: data.userId,
        audioFileId: data.audioFileId,
        error,
      });
    }
  }

  // ============================================================================
  // Individual Audio File Request Handler
  // ============================================================================

  private async handleAudioFileRequest(
    socket: Socket,
    audioFileId: string,
    compressed: boolean
  ): Promise<void> {
    try {
      const userId = socket.data.userId;

      // Get audio file metadata
      const audioFile = await this.audioFileSyncService.getAudioFileSyncMetadata(audioFileId);
      if (!audioFile) {
        socket.emit('error', { message: 'Audio file not found' });
        return;
      }

      // Send metadata first
      socket.emit('audio_file_metadata', {
        audioFile: {
          id: audioFileId,
          ...audioFile,
        },
        timestamp: new Date(),
      });

      // Get and send file data  
      const fileBuffer = await this.audioFileSyncService.getAudioFile(audioFileId);
      if (!fileBuffer) {
        socket.emit('error', { message: 'Audio file data not available' });
        return;
      }

      let responseBuffer = fileBuffer;
      let isCompressed = false;

      // Handle compression if requested and available
      if (compressed && audioFile.compressed) {
        try {
          responseBuffer = await this.audioFileSyncService.decompressAudioFile(fileBuffer);
          isCompressed = true;
        } catch (error) {
          loggingService.logError('Failed to decompress audio file for request', {
            audioFileId,
            error,
          });
          // Continue with original buffer
        }
      }

      // Send file data
      if (responseBuffer.length > 64 * 1024) { // 64KB threshold for chunking
        await this.sendAudioFileInChunks(socket, audioFileId, responseBuffer, isCompressed);
      } else {
        const base64Data = responseBuffer.toString('base64');
        socket.emit('audio_file_data', {
          audioFileId,
          data: base64Data,
          isCompressed,
          isComplete: true,
          size: responseBuffer.length,
          timestamp: new Date(),
        });
      }

      loggingService.logInfo('Audio file request fulfilled', {
        userId,
        audioFileId,
        size: responseBuffer.length,
        compressed: isCompressed,
      });

    } catch (error) {
      loggingService.logError('Failed to handle audio file request', {
        audioFileId,
        error,
      });
      socket.emit('error', { message: 'Failed to get audio file' });
    }
  }

  private async sendAudioFileInChunks(
    socket: Socket,
    audioFileId: string,
    buffer: Buffer,
    isCompressed: boolean
  ): Promise<void> {
    const chunkSize = 64 * 1024; // 64KB chunks
    const totalChunks = Math.ceil(buffer.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, buffer.length);
      const chunk = buffer.slice(start, end);
      const isLastChunk = i === totalChunks - 1;

      const base64Chunk = chunk.toString('base64');

      socket.emit('audio_file_chunk', {
        audioFileId,
        chunkIndex: i,
        totalChunks,
        data: base64Chunk,
        isCompressed,
        isComplete: isLastChunk,
        size: chunk.length,
        timestamp: new Date(),
      });

      // Small delay between chunks to prevent overwhelming
      if (!isLastChunk) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getNamespaceForRoom(_roomId: string): Namespace | null {
    // This would need to be implemented based on your Socket.IO setup
    // For now, returning null as placeholder
    return null;
  }

  private getSocketForUser(_userId: string): Socket | null {
    // This would need to be implemented based on your Socket.IO setup
    // You'd typically maintain a map of userId -> socket
    return null;
  }

  // ============================================================================
  // Room Management Integration
  // ============================================================================

  async handleUserJoinRoom(userId: string, roomId: string, socket: Socket): Promise<void> {
    try {
      // Store user and room info in socket data
      socket.data.userId = userId;
      socket.data.roomId = roomId;

      // Automatically start audio file distribution for new user
      await this.audioFileSyncService.distributeAudioFilesToNewUser(userId, roomId);

      loggingService.logInfo('User joined room - audio file sync initiated', {
        userId,
        roomId,
        socketId: socket.id,
      });

    } catch (error) {
      loggingService.logError('Failed to handle user join room for audio sync', {
        userId,
        roomId,
        error,
      });
    }
  }

  async handleUserLeaveRoom(userId: string, roomId: string, socket: Socket): Promise<void> {
    try {
      // Clear user and room info from socket data
      delete socket.data.userId;
      delete socket.data.roomId;

      // Clear any cached audio files for this user
      await this.audioFileSyncService.clearAudioFileCache();

      loggingService.logInfo('User left room - audio file cache cleared', {
        userId,
        roomId,
        socketId: socket.id,
      });

    } catch (error) {
      loggingService.logError('Failed to handle user leave room for audio sync', {
        userId,
        roomId,
        error,
      });
    }
  }
}