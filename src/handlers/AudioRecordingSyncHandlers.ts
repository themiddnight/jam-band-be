import { Socket } from 'socket.io';
import { AudioFileSyncService } from '../services/AudioFileSyncService';
import { ProjectStateManager } from '../services/ProjectStateManager';
import { loggingService } from '../services/LoggingService';

/**
 * Recording synchronization state for collaboration
 */
interface RecordingSyncState {
  userId: string;
  username: string;
  trackId: string;
  isRecording: boolean;
  recordingMode: string;
  startTime: number;
  duration: number;
  status: 'preparing' | 'recording' | 'processing' | 'uploading' | 'complete' | 'error';
  progress?: number;
  error?: string;
}

/**
 * Recording conflict data
 */
interface RecordingConflict {
  conflictId: string;
  type: 'simultaneous_recording' | 'track_locked' | 'resource_conflict';
  users: string[];
  trackId: string;
  message: string;
  resolutionOptions: {
    id: string;
    label: string;
    description: string;
  }[];
}

/**
 * Audio file distribution progress
 */
interface AudioFileDistributionProgress {
  fileId: string;
  filename: string;
  totalUsers: number;
  completedUsers: number;
  failedUsers: string[];
  status: 'distributing' | 'complete' | 'partial_failure' | 'failed';
}

/**
 * Audio Recording Synchronization Handlers
 * Manages real-time recording state synchronization and conflict resolution
 */
export class AudioRecordingSyncHandlers {
  private audioFileSyncService: AudioFileSyncService;
  private projectStateManager: ProjectStateManager;
  
  // Track active recording states per room
  private activeRecordings: Map<string, Map<string, RecordingSyncState>> = new Map();
  
  // Track active conflicts per room
  private activeConflicts: Map<string, RecordingConflict[]> = new Map();

  constructor() {
    this.audioFileSyncService = AudioFileSyncService.getInstance();
    this.projectStateManager = ProjectStateManager.getInstance();
  }

  /**
   * Setup recording synchronization handlers for a socket
   */
  setupHandlers(socket: Socket, roomId: string, userId: string, _username: string): void {
    // Recording state update
    socket.on('recording:state_update', (data: RecordingSyncState) => {
      this.handleRecordingStateUpdate(socket, roomId, userId, data);
    });

    // Recording conflict resolution
    socket.on('recording:resolve_conflict', (data: { conflictId: string; resolutionId: string }) => {
      this.handleConflictResolution(socket, roomId, userId, data);
    });

    // Audio file created notification
    socket.on('recording:audio_file_created', (data: {
      fileId: string;
      regionId: string;
      trackId: string;
      metadata: any;
    }) => {
      this.handleAudioFileCreated(socket, roomId, userId, data);
    });

    // Request file redistribution
    socket.on('recording:request_redistribution', (data: { fileId: string }) => {
      this.handleRedistributionRequest(socket, roomId, userId, data);
    });

    // User disconnection cleanup
    socket.on('disconnect', () => {
      this.handleUserDisconnect(roomId, userId);
    });

    // Send current recording state to new user
    this.sendCurrentRecordingState(socket, roomId);
  }

  /**
   * Handle recording state updates
   */
  private handleRecordingStateUpdate(
    socket: Socket,
    roomId: string,
    userId: string,
    data: RecordingSyncState
  ): void {
    try {
      // Validate the state update
      if (!this.validateRecordingState(data)) {
        loggingService.logError('Invalid recording state update', { userId, roomId, data });
        return;
      }

      // Get or create room recording map
      if (!this.activeRecordings.has(roomId)) {
        this.activeRecordings.set(roomId, new Map());
      }
      const roomRecordings = this.activeRecordings.get(roomId)!;

      // Check for conflicts before updating state
      if (data.isRecording && data.status === 'recording') {
        const conflict = this.detectRecordingConflict(roomId, userId, data);
        if (conflict) {
          this.handleRecordingConflict(socket, roomId, conflict);
          return;
        }
      }

      // Update the recording state
      roomRecordings.set(userId, { ...data, userId });

      // Clean up completed recordings after a delay
      if (data.status === 'complete' || data.status === 'error') {
        setTimeout(() => {
          roomRecordings.delete(userId);
        }, 5000); // Keep for 5 seconds for UI feedback
      }

      // Broadcast to other users in the room
      socket.to(roomId).emit('recording:state_update', {
        userId,
        state: data,
      });

      loggingService.logInfo('Recording state updated', {
        userId,
        roomId,
        trackId: data.trackId,
        status: data.status,
        isRecording: data.isRecording,
      });

    } catch (error) {
      loggingService.logError('Failed to handle recording state update', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roomId,
      });
    }
  }

  /**
   * Detect recording conflicts
   */
  private detectRecordingConflict(
    roomId: string,
    userId: string,
    newState: RecordingSyncState
  ): RecordingConflict | null {
    const roomRecordings = this.activeRecordings.get(roomId);
    if (!roomRecordings) return null;

    // Check for simultaneous recording on the same track
    const conflictingUsers: string[] = [];
    
    for (const [otherUserId, state] of roomRecordings) {
      if (otherUserId !== userId && 
          state.isRecording && 
          state.trackId === newState.trackId &&
          state.status === 'recording') {
        conflictingUsers.push(otherUserId);
      }
    }

    if (conflictingUsers.length > 0) {
      const conflict: RecordingConflict = {
        conflictId: `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'simultaneous_recording',
        users: [userId, ...conflictingUsers],
        trackId: newState.trackId,
        message: `Multiple users are trying to record on the same track`,
        resolutionOptions: [
          {
            id: 'take_control',
            label: 'Take Control',
            description: 'Stop other recordings and start yours'
          },
          {
            id: 'wait',
            label: 'Wait',
            description: 'Wait for other recordings to finish'
          },
          {
            id: 'cancel',
            label: 'Cancel',
            description: 'Cancel your recording attempt'
          }
        ],
      };

      return conflict;
    }

    return null;
  }

  /**
   * Handle recording conflicts
   */
  private handleRecordingConflict(
    socket: Socket,
    roomId: string,
    conflict: RecordingConflict
  ): void {
    try {
      // Store the conflict
      if (!this.activeConflicts.has(roomId)) {
        this.activeConflicts.set(roomId, []);
      }
      this.activeConflicts.get(roomId)!.push(conflict);

      // Notify all involved users
      conflict.users.forEach((_userId) => {
        socket.to(roomId).emit('recording:conflict', conflict);
      });

      // Also notify the initiating user
      socket.emit('recording:conflict', conflict);

      loggingService.logInfo('Recording conflict detected', {
        conflictId: conflict.conflictId,
        roomId,
        type: conflict.type,
        users: conflict.users,
        trackId: conflict.trackId,
      });

    } catch (error) {
      loggingService.logError('Failed to handle recording conflict', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId,
        conflictId: conflict.conflictId,
      });
    }
  }

  /**
   * Handle conflict resolution
   */
  private handleConflictResolution(
    socket: Socket,
    roomId: string,
    userId: string,
    data: { conflictId: string; resolutionId: string }
  ): void {
    try {
      const roomConflicts = this.activeConflicts.get(roomId);
      if (!roomConflicts) return;

      const conflictIndex = roomConflicts.findIndex(c => c.conflictId === data.conflictId);
      if (conflictIndex === -1) return;

      const conflict = roomConflicts[conflictIndex];
      if (!conflict) {
        return;
      }

      // Verify user is involved in the conflict
      if (!conflict.users.includes(userId)) {
        loggingService.logError('User not involved in conflict resolution', {
          userId,
          conflictId: data.conflictId,
        });
        return;
      }

      // Handle different resolution types
      switch (data.resolutionId) {
        case 'take_control':
          this.handleTakeControlResolution(socket, roomId, userId, conflict);
          break;
        case 'wait':
          // Just remove the conflict for this user
          break;
        case 'cancel':
          this.handleCancelResolution(socket, roomId, userId, conflict);
          break;
      }

      // Remove the conflict
      roomConflicts.splice(conflictIndex, 1);

      // Notify all users about the resolution
      socket.to(roomId).emit('recording:conflict_resolved', {
        conflictId: data.conflictId,
        resolutionId: data.resolutionId,
        resolvedBy: userId,
      });

      loggingService.logInfo('Recording conflict resolved', {
        conflictId: data.conflictId,
        resolutionId: data.resolutionId,
        resolvedBy: userId,
        roomId,
      });

    } catch (error) {
      loggingService.logError('Failed to handle conflict resolution', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roomId,
        conflictId: data.conflictId,
      });
    }
  }

  /**
   * Handle take control resolution
   */
  private handleTakeControlResolution(
    socket: Socket,
    roomId: string,
    userId: string,
    conflict: RecordingConflict
  ): void {
    const roomRecordings = this.activeRecordings.get(roomId);
    if (!roomRecordings) return;

    // Stop recordings for other users involved in the conflict
    conflict.users.forEach(otherUserId => {
      if (otherUserId !== userId) {
        const state = roomRecordings.get(otherUserId);
        if (state && state.isRecording) {
          // Force stop their recording
          const stoppedState: RecordingSyncState = {
            ...state,
            isRecording: false,
            status: 'complete',
          };
          
          roomRecordings.set(otherUserId, stoppedState);
          
          // Notify the user their recording was stopped
          socket.to(roomId).emit('recording:force_stop', {
            userId: otherUserId,
            reason: 'conflict_resolution',
            resolvedBy: userId,
          });
        }
      }
    });
  }

  /**
   * Handle cancel resolution
   */
  private handleCancelResolution(
    socket: Socket,
    roomId: string,
    userId: string,
    _conflict: RecordingConflict
  ): void {
    const roomRecordings = this.activeRecordings.get(roomId);
    if (!roomRecordings) return;

    // Cancel the user's recording
    const state = roomRecordings.get(userId);
    if (state && state.isRecording) {
      const cancelledState: RecordingSyncState = {
        ...state,
        isRecording: false,
        status: 'complete',
      };
      
      roomRecordings.set(userId, cancelledState);
    }
  }

  /**
   * Handle audio file created notification
   */
  private handleAudioFileCreated(
    socket: Socket,
    roomId: string,
    userId: string,
    data: { fileId: string; regionId: string; trackId: string; metadata: any }
  ): void {
    try {
      // Broadcast to other users that a new audio file is available
      socket.to(roomId).emit('recording:audio_file_created', {
        ...data,
        createdBy: userId,
      });

      // Start file distribution process
      this.initiateFileDistribution(socket, roomId, data.fileId, data.metadata);

      loggingService.logInfo('Audio file created and distributed', {
        fileId: data.fileId,
        regionId: data.regionId,
        trackId: data.trackId,
        createdBy: userId,
        roomId,
      });

    } catch (error) {
      loggingService.logError('Failed to handle audio file created', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roomId,
        fileId: data.fileId,
      });
    }
  }

  /**
   * Initiate file distribution to all users in the room
   */
  private async initiateFileDistribution(
    socket: Socket,
    roomId: string,
    fileId: string,
    metadata: any
  ): Promise<void> {
    try {
      // Get all users in the room (this would come from room service)
      const roomUsers = await this.getRoomUsers(roomId);
      
      const distributionProgress: AudioFileDistributionProgress = {
        fileId,
        filename: metadata.filename,
        totalUsers: roomUsers.length,
        completedUsers: 1, // Creator already has it
        failedUsers: [],
        status: 'distributing',
      };

      // Broadcast initial distribution progress
      socket.to(roomId).emit('recording:file_distribution_progress', distributionProgress);

      // In a real implementation, this would trigger WebRTC file transfer
      // For now, we'll simulate the distribution process
      setTimeout(() => {
        distributionProgress.status = 'complete';
        distributionProgress.completedUsers = roomUsers.length;
        
        socket.to(roomId).emit('recording:file_distribution_progress', distributionProgress);
      }, 2000);

    } catch (error) {
      loggingService.logError('Failed to initiate file distribution', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId,
        fileId,
      });
    }
  }

  /**
   * Handle redistribution request
   */
  private handleRedistributionRequest(
    socket: Socket,
    roomId: string,
    userId: string,
    data: { fileId: string }
  ): void {
    try {
      // Log the redistribution request
      loggingService.logInfo('File redistribution requested', {
        fileId: data.fileId,
        requestedBy: userId,
        roomId,
      });

      // In a real implementation, this would trigger file redistribution
      // For now, just acknowledge the request
      socket.emit('recording:redistribution_started', {
        fileId: data.fileId,
        status: 'started',
      });

    } catch (error) {
      loggingService.logError('Failed to handle redistribution request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roomId,
        fileId: data.fileId,
      });
    }
  }

  /**
   * Handle user disconnect cleanup
   */
  private handleUserDisconnect(roomId: string, userId: string): void {
    try {
      // Clean up user's recording state
      const roomRecordings = this.activeRecordings.get(roomId);
      if (roomRecordings) {
        roomRecordings.delete(userId);
        
        // If room is empty, clean up the entire room
        if (roomRecordings.size === 0) {
          this.activeRecordings.delete(roomId);
        }
      }

      // Clean up conflicts involving this user
      const roomConflicts = this.activeConflicts.get(roomId);
      if (roomConflicts) {
        const updatedConflicts = roomConflicts.filter(conflict => 
          !conflict.users.includes(userId)
        );
        
        if (updatedConflicts.length === 0) {
          this.activeConflicts.delete(roomId);
        } else {
          this.activeConflicts.set(roomId, updatedConflicts);
        }
      }

      loggingService.logInfo('User recording state cleaned up', {
        userId,
        roomId,
      });

    } catch (error) {
      loggingService.logError('Failed to cleanup user recording state', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        roomId,
      });
    }
  }

  /**
   * Send current recording state to a new user
   */
  private sendCurrentRecordingState(socket: Socket, roomId: string): void {
    try {
      const roomRecordings = this.activeRecordings.get(roomId);
      if (roomRecordings) {
        // Send all active recording states
        for (const [userId, state] of roomRecordings) {
          socket.emit('recording:state_update', {
            userId,
            state,
          });
        }
      }

      const roomConflicts = this.activeConflicts.get(roomId);
      if (roomConflicts) {
        // Send all active conflicts
        roomConflicts.forEach(conflict => {
          socket.emit('recording:conflict', conflict);
        });
      }

    } catch (error) {
      loggingService.logError('Failed to send current recording state', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId,
      });
    }
  }

  /**
   * Validate recording state data
   */
  private validateRecordingState(state: RecordingSyncState): boolean {
    return !!(
      state.userId &&
      state.trackId &&
      typeof state.isRecording === 'boolean' &&
      state.recordingMode &&
      typeof state.startTime === 'number' &&
      state.status
    );
  }

  /**
   * Get users in a room (placeholder - would integrate with room service)
   */
  private async getRoomUsers(_roomId: string): Promise<string[]> {
    // This would integrate with the actual room service
    // For now, return a placeholder
    return ['user1', 'user2', 'user3'];
  }
}

export default AudioRecordingSyncHandlers;