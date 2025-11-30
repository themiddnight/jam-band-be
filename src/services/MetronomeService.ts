import { Server, Namespace } from 'socket.io';
import { RoomService } from './RoomService';
import { MetronomeTickData } from '../types';
import { getHighResolutionTime } from '../shared/utils/timing';

/**
 * Room-specific metronome instance for namespace-isolated broadcasting
 * Requirements: 8.1, 8.2, 8.3
 */
export class RoomMetronome {
  private timeoutId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private pendingBpm: number | null = null;
  private tempoUpdateTimeout: NodeJS.Timeout | null = null;
  private onTempoApplied: ((bpm: number) => void) | null = null;
  
  // Self-correcting timer state
  private expectedNextTickTime: number = 0;
  private tickCount: number = 0;
  private startTime: number = 0;
  
  // Drift monitoring
  private maxDriftMs: number = 0;
  private totalDriftMs: number = 0;
  private driftSamples: number = 0;

  constructor(
    private roomId: string,
    private namespace: Namespace,
    private roomService: RoomService
  ) {}

  /**
   * Start the metronome for this specific room using self-correcting timer
   * This approach eliminates drift by calculating next tick time from the expected time
   * rather than the actual time, compensating for any delays in the event loop.
   * Requirements: 8.1, 8.2
   */
  start(): void {
    this.stop(); // Clear any existing timer

    const metronomeState = this.roomService.getMetronomeState(this.roomId);
    if (!metronomeState) return;

    const intervalMs = (60 / metronomeState.bpm) * 1000; // Convert BPM to milliseconds
    
    // Initialize timing state
    this.startTime = getHighResolutionTime();
    this.expectedNextTickTime = this.startTime;
    this.tickCount = 0;
    this.maxDriftMs = 0;
    this.totalDriftMs = 0;
    this.driftSamples = 0;
    this.isRunning = true;

    const tick = () => {
      if (!this.isRunning) return;
      
      const currentState = this.roomService.getMetronomeState(this.roomId);
      if (!currentState) {
        this.stop();
        return;
      }

      const now = getHighResolutionTime();
      const currentIntervalMs = (60 / currentState.bpm) * 1000;
      
      // Calculate drift for monitoring
      const expectedTimeMs = (this.expectedNextTickTime - this.startTime) / 1_000_000;
      const actualTimeMs = (now - this.startTime) / 1_000_000;
      const driftMs = Math.abs(actualTimeMs - expectedTimeMs);
      
      // Update drift statistics
      this.maxDriftMs = Math.max(this.maxDriftMs, driftMs);
      this.totalDriftMs += driftMs;
      this.driftSamples++;

      // Check if there's a pending tempo update and apply it
      if (this.pendingBpm !== null) {
        const appliedBpm = this.pendingBpm;
        this.pendingBpm = null;
        
        // Clear any pending timeout
        if (this.tempoUpdateTimeout) {
          clearTimeout(this.tempoUpdateTimeout);
          this.tempoUpdateTimeout = null;
        }
        
        // Notify that tempo has been applied
        if (this.onTempoApplied) {
          this.onTempoApplied(appliedBpm);
        }
        
        // Recalculate interval for new tempo
        // The next tick will use the new interval
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
      
      this.tickCount++;
      
      // Calculate next expected tick time based on ideal timing, not actual
      // This is the key to self-correction - we always schedule from the expected time
      this.expectedNextTickTime += currentIntervalMs * 1_000_000; // Convert to nanoseconds
      
      // Calculate delay until next tick
      // If we're behind, this will be shorter; if we're ahead, this will be longer
      const nextTickDelayNs = this.expectedNextTickTime - getHighResolutionTime();
      const nextTickDelayMs = Math.max(0, nextTickDelayNs / 1_000_000);
      
      // Schedule next tick
      this.timeoutId = setTimeout(tick, nextTickDelayMs);
    };

    // Send initial tick immediately
    tick();
  }

  /**
   * Stop the metronome for this room
   * Requirements: 8.3
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.tempoUpdateTimeout) {
      clearTimeout(this.tempoUpdateTimeout);
      this.tempoUpdateTimeout = null;
    }
    this.isRunning = false;
    this.pendingBpm = null;
  }

  /**
   * Update metronome tempo with smooth transition
   * The tempo change is applied on the next tick to maintain timing consistency
   * Requirements: 8.2
   */
  updateTempo(newBpm: number): void {
    // Store the pending BPM update - will be applied on next tick
    // This approach maintains timing consistency without needing to restart
    this.pendingBpm = newBpm;
    
    // Also update the room service immediately so the new BPM is reflected
    this.roomService.updateMetronomeBPM(this.roomId, newBpm);
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
   * Set callback to be called when tempo is actually applied
   */
  setOnTempoApplied(callback: (bpm: number) => void): void {
    this.onTempoApplied = callback;
  }

  /**
   * Get room ID for this metronome instance
   */
  getRoomId(): string {
    return this.roomId;
  }
  
  /**
   * Get drift statistics for monitoring
   */
  getDriftStats(): { maxDriftMs: number; avgDriftMs: number; tickCount: number } {
    return {
      maxDriftMs: this.maxDriftMs,
      avgDriftMs: this.driftSamples > 0 ? this.totalDriftMs / this.driftSamples : 0,
      tickCount: this.tickCount
    };
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
   * Get drift statistics for all active metronomes
   * Useful for monitoring timing stability across multiple rooms
   */
  getAllDriftStats(): Map<string, { maxDriftMs: number; avgDriftMs: number; tickCount: number }> {
    const stats = new Map<string, { maxDriftMs: number; avgDriftMs: number; tickCount: number }>();
    for (const [roomId, metronome] of this.roomMetronomes.entries()) {
      if (metronome.getIsRunning()) {
        stats.set(roomId, metronome.getDriftStats());
      }
    }
    return stats;
  }

  /**
   * Get aggregated drift statistics across all rooms
   * Returns overall system timing health
   */
  getSystemDriftStats(): { 
    totalRooms: number; 
    maxDriftMs: number; 
    avgDriftMs: number;
    roomsWithHighDrift: number; // rooms with >5ms drift
  } {
    let maxDrift = 0;
    let totalDrift = 0;
    let totalSamples = 0;
    let highDriftRooms = 0;
    const HIGH_DRIFT_THRESHOLD_MS = 5;

    for (const metronome of this.roomMetronomes.values()) {
      if (metronome.getIsRunning()) {
        const stats = metronome.getDriftStats();
        maxDrift = Math.max(maxDrift, stats.maxDriftMs);
        totalDrift += stats.avgDriftMs * stats.tickCount;
        totalSamples += stats.tickCount;
        if (stats.maxDriftMs > HIGH_DRIFT_THRESHOLD_MS) {
          highDriftRooms++;
        }
      }
    }

    return {
      totalRooms: this.roomMetronomes.size,
      maxDriftMs: maxDrift,
      avgDriftMs: totalSamples > 0 ? totalDrift / totalSamples : 0,
      roomsWithHighDrift: highDriftRooms
    };
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
