import { Server, Namespace } from 'socket.io';
import { RoomService } from './RoomService';
import { MetronomeTickData } from '../types';

/**
 * Room-specific metronome instance for namespace-isolated broadcasting
 * Requirements: 8.1, 8.2, 8.3
 */
export class RoomMetronome {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private pendingBpm: number | null = null;
  private tempoUpdateTimeout: NodeJS.Timeout | null = null;

  constructor(
    private roomId: string,
    private namespace: Namespace,
    private roomService: RoomService
  ) {}

  /**
   * Start the metronome for this specific room
   * Requirements: 8.1, 8.2
   */
  start(): void {
    this.stop(); // Clear any existing interval

    const metronomeState = this.roomService.getMetronomeState(this.roomId);
    if (!metronomeState) return;

    const intervalMs = (60 / metronomeState.bpm) * 1000; // Convert BPM to milliseconds

    const tick = () => {
      const currentState = this.roomService.getMetronomeState(this.roomId);
      if (!currentState) {
        this.stop();
        return;
      }

      // Check if there's a pending tempo update and apply it after this tick
      if (this.pendingBpm !== null) {
        this.pendingBpm = null;
        
        // Clear any pending timeout
        if (this.tempoUpdateTimeout) {
          clearTimeout(this.tempoUpdateTimeout);
          this.tempoUpdateTimeout = null;
        }
        
        // Apply the new tempo by restarting with new BPM
        // This will happen after the current tick is broadcast
        setTimeout(() => {
          if (this.isRunning) {
            this.start();
          }
        }, 0);
      }

      const tickTimestamp = Date.now();
      
      // Update the room's last tick timestamp
      const room = this.roomService.getRoom(this.roomId);
      if (room) {
        room.metronome.lastTickTimestamp = tickTimestamp;
      }

      // Broadcast tick only to this room's namespace
      this.broadcastTick({
        timestamp: tickTimestamp,
        bpm: currentState.bpm
      });
    };

    // Start the interval
    this.intervalId = setInterval(tick, intervalMs);
    this.isRunning = true;

    // Send initial tick immediately
    tick();
  }

  /**
   * Stop the metronome for this room
   * Requirements: 8.3
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.tempoUpdateTimeout) {
      clearTimeout(this.tempoUpdateTimeout);
      this.tempoUpdateTimeout = null;
    }
    this.isRunning = false;
    this.pendingBpm = null;
  }

  /**
   * Update metronome tempo and restart with new BPM
   * Uses debouncing to wait for the next tick before applying changes
   * Requirements: 8.2
   */
  updateTempo(newBpm: number): void {
    // Get current metronome state to calculate debounce time
    const currentState = this.roomService.getMetronomeState(this.roomId);
    if (!currentState) return;

    // Store the pending BPM update
    this.pendingBpm = newBpm;

    // Clear any existing timeout
    if (this.tempoUpdateTimeout) {
      clearTimeout(this.tempoUpdateTimeout);
    }

    // Calculate time until next tick based on current BPM
    // This ensures we wait for at least one tick cycle before applying the change
    const currentIntervalMs = (60 / currentState.bpm) * 1000;
    
    // Set a timeout to apply the tempo change after the current tick cycle
    // Add a small buffer (50ms) to ensure we're past the tick
    this.tempoUpdateTimeout = setTimeout(() => {
      if (this.isRunning && this.pendingBpm !== null) {
        // The actual restart will happen on the next tick
        // No need to do anything here - the tick function will handle it
      }
    }, currentIntervalMs + 50);
  }

  /**
   * Broadcast metronome tick to room namespace only
   * Requirements: 8.2, 8.3
   */
  private broadcastTick(tickData: MetronomeTickData): void {
    this.namespace.emit('metronome_tick', tickData);
  }

  /**
   * Check if metronome is currently running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get room ID for this metronome instance
   */
  getRoomId(): string {
    return this.roomId;
  }

  /**
   * Clean up resources when room is destroyed
   * Requirements: 8.5
   */
  cleanup(): void {
    this.stop();
  }
}

/**
 * Namespace-aware metronome service that manages per-room metronome instances
 * Requirements: 8.1, 8.2, 8.3, 8.5
 */
export class MetronomeService {
  private roomMetronomes = new Map<string, RoomMetronome>();

  constructor(private io: Server, private roomService: RoomService) {}

  /**
   * Initialize metronome for a room with its namespace
   * Requirements: 8.1, 8.2
   */
  initializeRoomMetronome(roomId: string, namespace: Namespace): void {
    // Clean up any existing metronome for this room
    this.cleanupRoom(roomId);

    // Create new room metronome instance
    const roomMetronome = new RoomMetronome(roomId, namespace, this.roomService);
    this.roomMetronomes.set(roomId, roomMetronome);

    // Start the metronome
    roomMetronome.start();
  }

  /**
   * Start metronome for a specific room
   * Requirements: 8.1, 8.2
   */
  startMetronome(roomId: string): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.start();
    }
  }

  /**
   * Stop metronome for a specific room
   * Requirements: 8.3
   */
  stopMetronome(roomId: string): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.stop();
    }
  }

  /**
   * Update metronome tempo for a specific room
   * Requirements: 8.2
   */
  updateMetronomeTempo(roomId: string, newBpm: number): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.updateTempo(newBpm);
    }
  }

  /**
   * Clean up metronome instance when room becomes empty
   * Requirements: 8.5
   */
  cleanupRoom(roomId: string): void {
    const roomMetronome = this.roomMetronomes.get(roomId);
    if (roomMetronome) {
      roomMetronome.cleanup();
      this.roomMetronomes.delete(roomId);
    }
  }

  /**
   * Get active metronomes for monitoring
   */
  getActiveMetronomes(): string[] {
    return Array.from(this.roomMetronomes.keys()).filter(roomId => {
      const metronome = this.roomMetronomes.get(roomId);
      return metronome?.getIsRunning() || false;
    });
  }

  /**
   * Get room metronome instance for direct access
   */
  getRoomMetronome(roomId: string): RoomMetronome | undefined {
    return this.roomMetronomes.get(roomId);
  }

  /**
   * Get total number of managed metronome instances
   */
  getTotalMetronomes(): number {
    return this.roomMetronomes.size;
  }

  /**
   * Clean up all metronome instances (for service shutdown)
   * Requirements: 8.5
   */
  shutdown(): void {
  for (const [ _roomId, metronome] of this.roomMetronomes.entries()) {
      metronome.cleanup();
    }
    this.roomMetronomes.clear();
  }
}
