import { Socket } from 'socket.io';
import { RoomService } from '../services/RoomService';
import { LoggingService } from '../services/LoggingService';

/**
 * DAW Room Configuration Handlers
 * Handles produce room specific configuration and state management
 */

export interface DAWRoomConfig {
  projectName: string;
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  transportMode: 'private' | 'public';
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  allowGuestEditing: boolean;
  autoSaveEnabled: boolean;
  autoSaveInterval: number;
  sampleRate: number;
  bufferSize: number;
  timelineZoom: number;
  trackHeight: number;
  showMixer: boolean;
  showEffects: boolean;
}

export interface DAWRoomState {
  isRecording: boolean;
  isPlaying: boolean;
  currentPosition: number;
  selectedTracks: string[];
  soloTracks: string[];
  mutedTracks: string[];
}

const DEFAULT_DAW_CONFIG: DAWRoomConfig = {
  projectName: "Untitled Project",
  tempo: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  transportMode: 'private',
  loopEnabled: false,
  loopStart: 0,
  loopEnd: 16,
  allowGuestEditing: true,
  autoSaveEnabled: true,
  autoSaveInterval: 30,
  sampleRate: 44100,
  bufferSize: 512,
  timelineZoom: 1,
  trackHeight: 64,
  showMixer: true,
  showEffects: true,
};

const DEFAULT_DAW_STATE: DAWRoomState = {
  isRecording: false,
  isPlaying: false,
  currentPosition: 0,
  selectedTracks: [],
  soloTracks: [],
  mutedTracks: [],
};

export class DAWRoomHandlers {
  private roomConfigs = new Map<string, DAWRoomConfig>();
  private roomStates = new Map<string, DAWRoomState>();

  constructor(
    private roomService: RoomService,
    private loggingService: LoggingService
  ) {}

  /**
   * Register DAW-specific socket event handlers
   */
  registerHandlers(socket: Socket, roomId: string, userId: string): void {
    // Get DAW configuration
    socket.on('daw:get_config', (data, callback) => {
      try {
        const { roomId: requestedRoomId } = data;
        
        if (requestedRoomId !== roomId) {
          callback({ success: false, error: 'Invalid room ID' });
          return;
        }

        const room = this.roomService.getRoom(roomId);
        if (!room || room.roomType !== 'produce') {
          callback({ success: false, error: 'Room not found or not a produce room' });
          return;
        }

        // Initialize config and state if not exists
        if (!this.roomConfigs.has(roomId)) {
          this.roomConfigs.set(roomId, { ...DEFAULT_DAW_CONFIG });
        }
        if (!this.roomStates.has(roomId)) {
          this.roomStates.set(roomId, { ...DEFAULT_DAW_STATE });
        }

        const config = this.roomConfigs.get(roomId);
        const state = this.roomStates.get(roomId);

        callback({
          success: true,
          config,
          state
        });

        this.loggingService.logInfo('DAW config requested', {
          roomId,
          userId,
          hasConfig: !!config,
          hasState: !!state
        });
      } catch (error) {
        this.loggingService.logError('Error getting DAW config', error as Error, {
          roomId,
          userId
        });
        callback({ success: false, error: 'Internal server error' });
      }
    });

    // Update DAW configuration
    socket.on('daw:update_config', (data) => {
      try {
        const { roomId: requestedRoomId, config: configUpdates, updatedBy } = data;
        
        if (requestedRoomId !== roomId) {
          return;
        }

        const room = this.roomService.getRoom(roomId);
        if (!room || room.roomType !== 'produce') {
          return;
        }

        const user = room.users.get(userId);
        if (!user) {
          return;
        }

        // Check permissions for configuration changes
        const userEditableSettings = ['timelineZoom', 'trackHeight', 'showMixer', 'showEffects'];
        const isUserEditable = Object.keys(configUpdates).every(key => 
          userEditableSettings.includes(key) || user.role === 'room_owner'
        );

        if (!isUserEditable) {
          socket.emit('daw:config_error', { error: 'Insufficient permissions' });
          return;
        }

        // Update configuration
        const currentConfig = this.roomConfigs.get(roomId) || { ...DEFAULT_DAW_CONFIG };
        const updatedConfig = { ...currentConfig, ...configUpdates };
        this.roomConfigs.set(roomId, updatedConfig);

        // Broadcast configuration update to all users in the room
        socket.to(roomId).emit('daw:config_updated', {
          config: configUpdates,
          updatedBy
        });

        this.loggingService.logInfo('DAW config updated', {
          roomId,
          userId,
          updatedBy,
          updates: Object.keys(configUpdates)
        });
      } catch (error) {
        this.loggingService.logError('Error updating DAW config', error as Error, {
          roomId,
          userId
        });
      }
    });

    // Update DAW state
    socket.on('daw:update_state', (data) => {
      try {
        const { roomId: requestedRoomId, state: stateUpdates, updatedBy } = data;
        
        if (requestedRoomId !== roomId) {
          return;
        }

        const room = this.roomService.getRoom(roomId);
        if (!room || room.roomType !== 'produce') {
          return;
        }

        const user = room.users.get(userId);
        if (!user) {
          return;
        }

        // Update state
        const currentState = this.roomStates.get(roomId) || { ...DEFAULT_DAW_STATE };
        const updatedState = { ...currentState, ...stateUpdates };
        this.roomStates.set(roomId, updatedState);

        // Broadcast state update to all users in the room
        socket.to(roomId).emit('daw:state_updated', {
          state: stateUpdates,
          updatedBy
        });

        this.loggingService.logInfo('DAW state updated', {
          roomId,
          userId,
          updatedBy,
          updates: Object.keys(stateUpdates)
        });
      } catch (error) {
        this.loggingService.logError('Error updating DAW state', error as Error, {
          roomId,
          userId
        });
      }
    });
  }

  /**
   * Clean up DAW data when room is closed
   */
  cleanupRoom(roomId: string): void {
    this.roomConfigs.delete(roomId);
    this.roomStates.delete(roomId);
    
    this.loggingService.logInfo('DAW room data cleaned up', { roomId });
  }

  /**
   * Get current DAW configuration for a room
   */
  getRoomConfig(roomId: string): DAWRoomConfig | null {
    return this.roomConfigs.get(roomId) || null;
  }

  /**
   * Get current DAW state for a room
   */
  getRoomState(roomId: string): DAWRoomState | null {
    return this.roomStates.get(roomId) || null;
  }

  /**
   * Initialize DAW configuration for a new produce room
   */
  initializeRoom(roomId: string, initialConfig?: Partial<DAWRoomConfig>): void {
    const config = { ...DEFAULT_DAW_CONFIG, ...initialConfig };
    const state = { ...DEFAULT_DAW_STATE };
    
    this.roomConfigs.set(roomId, config);
    this.roomStates.set(roomId, state);
    
    this.loggingService.logInfo('DAW room initialized', { 
      roomId, 
      hasCustomConfig: !!initialConfig 
    });
  }
}