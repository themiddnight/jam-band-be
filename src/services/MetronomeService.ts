import { Server } from 'socket.io';
import { RoomService } from './RoomService';

export class MetronomeService {
  private roomIntervals = new Map<string, NodeJS.Timeout>();
  private static instance: MetronomeService;

  constructor(private io: Server, private roomService: RoomService) {}

  static getInstance(io: Server, roomService: RoomService): MetronomeService {
    if (!MetronomeService.instance) {
      MetronomeService.instance = new MetronomeService(io, roomService);
    }
    return MetronomeService.instance;
  }

  startMetronome(roomId: string): void {
    this.stopMetronome(roomId); // Clear any existing interval

    const metronomeState = this.roomService.getMetronomeState(roomId);
    if (!metronomeState) return;

    const intervalMs = (60 / metronomeState.bpm) * 1000; // Convert BPM to milliseconds

    const tick = () => {
      const currentState = this.roomService.getMetronomeState(roomId);
      if (!currentState) {
        this.stopMetronome(roomId);
        return;
      }

      const tickTimestamp = Date.now();
      
      // Update the room's last tick timestamp
      const room = this.roomService.getRoom(roomId);
      if (room) {
        room.metronome.lastTickTimestamp = tickTimestamp;
      }

      // Broadcast tick to all users in the room
      this.io.to(roomId).emit('metronome_tick', {
        timestamp: tickTimestamp,
        bpm: currentState.bpm
      });
    };

    // Start the interval
    const intervalId = setInterval(tick, intervalMs);
    this.roomIntervals.set(roomId, intervalId);

    // Send initial tick immediately
    tick();
  }

  stopMetronome(roomId: string): void {
    const intervalId = this.roomIntervals.get(roomId);
    if (intervalId) {
      clearInterval(intervalId);
      this.roomIntervals.delete(roomId);
    }
  }

  updateMetronomeTempo(roomId: string, newBpm: number): void {
    // Always restart with new tempo since metronome is always running
    this.startMetronome(roomId);
  }

  cleanupRoom(roomId: string): void {
    this.stopMetronome(roomId);
  }

  // Get active metronomes for monitoring
  getActiveMetronomes(): string[] {
    return Array.from(this.roomIntervals.keys());
  }

  // Start metronome for a newly created room
  initializeRoomMetronome(roomId: string): void {
    this.startMetronome(roomId);
  }
}
