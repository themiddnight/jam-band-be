import { Socket, Namespace } from 'socket.io';
import { RoomService } from '../../../../services/RoomService';
import { MetronomeService } from '../../../../services/MetronomeService';
import { RoomSessionManager } from '../../../../services/RoomSessionManager';
import { NamespaceManager } from '../../../../services/NamespaceManager';
import { UpdateMetronomeData } from '../../../../types';

/**
 * Handler for metronome functionality
 * Requirements: 4.1, 4.6
 */
export class MetronomeHandler {
  constructor(
    private roomService: RoomService,
    private metronomeService: MetronomeService,
    private roomSessionManager: RoomSessionManager,
    private namespaceManager: NamespaceManager
  ) {}

  /**
   * Helper method to get or create room namespace
   * This ensures the namespace exists before we try to use it
   */
  private getOrCreateRoomNamespace(roomId: string): Namespace | null {
    let roomNamespace = this.namespaceManager.getRoomNamespace(roomId);
    if (!roomNamespace) {
      // Create the room namespace if it doesn't exist
      console.log('🔧 Creating room namespace for roomId:', roomId);
      try {
        roomNamespace = this.namespaceManager.createRoomNamespace(roomId);
      } catch (error) {
        console.error('❌ Failed to create room namespace for roomId:', roomId, error);
        return null;
      }
    }
    return roomNamespace;
  }

  /**
   * Handle metronome BPM update
   * Requirements: 4.1, 4.6
   */
  handleUpdateMetronome(socket: Socket, data: UpdateMetronomeData): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Only room owner and band members can control metronome
    if (user.role !== 'room_owner' && user.role !== 'band_member') return;

    const updatedRoom = this.roomService.updateMetronomeBPM(session.roomId, data.bpm);
    if (!updatedRoom) return;

    // Update tempo in metronome service
    this.metronomeService.updateMetronomeTempo(session.roomId, data.bpm);

    // Get or create the room namespace for proper isolation
    const roomNamespace = this.getOrCreateRoomNamespace(session.roomId);
    if (roomNamespace) {
      // Broadcast metronome state to all users in the room
      roomNamespace.emit('metronome_updated', {
        bpm: updatedRoom.metronome.bpm,
        lastTickTimestamp: updatedRoom.metronome.lastTickTimestamp
      });
    }
  }

  /**
   * Handle request for current metronome state
   * Requirements: 4.1, 4.6
   */
  handleRequestMetronomeState(socket: Socket): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const metronomeState = this.roomService.getMetronomeState(session.roomId);
    if (!metronomeState) return;

    // Send current metronome state to the requesting user
    socket.emit('metronome_state', metronomeState);
  }

  /**
   * Handle metronome BPM update through namespace
   * Requirements: 4.1, 4.6
   */
  handleUpdateMetronomeNamespace(socket: Socket, data: UpdateMetronomeData, namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const room = this.roomService.getRoom(session.roomId);
    if (!room) return;

    const user = room.users.get(session.userId);
    if (!user) return;

    // Only room owner and band members can control metronome
    if (user.role !== 'room_owner' && user.role !== 'band_member') return;

    const updatedRoom = this.roomService.updateMetronomeBPM(session.roomId, data.bpm);
    if (!updatedRoom) return;

    // Update tempo in metronome service
    this.metronomeService.updateMetronomeTempo(session.roomId, data.bpm);

    // Broadcast metronome state to all users in namespace
    namespace.emit('metronome_updated', {
      bpm: updatedRoom.metronome.bpm,
      lastTickTimestamp: updatedRoom.metronome.lastTickTimestamp
    });
  }

  /**
   * Handle request for current metronome state through namespace
   * Requirements: 4.1, 4.6
   */
  handleRequestMetronomeStateNamespace(socket: Socket, _namespace: Namespace): void {
    const session = this.roomSessionManager.getRoomSession(socket.id);
    if (!session) return;

    const metronomeState = this.roomService.getMetronomeState(session.roomId);
    if (!metronomeState) return;

    // Send current metronome state to the requesting user
    socket.emit('metronome_state', metronomeState);
  }
}