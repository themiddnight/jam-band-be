import { Server, Namespace } from 'socket.io';
import { RoomService } from './RoomService';
import { MetronomeState, MetronomeTickData } from '../types';

/**
 * Room-specific metronome instance for namespace-isolated broadcasting
 * Requirements: 8.1, 8.2, 8.3
 */
export class RoomMetronome {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

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
    this.isRunning = false;
  }

  /**
   * Update metronome tempo and restart with new BPM
   * Requirements: 8.2
   */
  updateTempo(newBpm: number): void {
    // Always restart with new tempo since metronome is always running
    this.start();
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
    for (const [roomId, metronome] of this.roomMetronomes.entries()) {
      metronome.cleanup();
    }
    this.roomMetronomes.clear();
  }
}
