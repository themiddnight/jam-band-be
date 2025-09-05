/**
 * In-Memory Room Repository Implementation
 * 
 * Provides in-memory storage for Room aggregates using Map-based storage.
 * This implementation maintains data consistency and supports all repository operations
 * without requiring external database dependencies.
 * 
 * Requirements: 1.3, 1.4
 */

import { RoomRepository } from '../../domain/repositories/RoomRepository';
import { Room } from '../../domain/models/Room';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

export class InMemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, Room>();

  async save(room: Room): Promise<void> {
    this.rooms.set(room.id.toString(), room);
  }

  async findById(id: RoomId): Promise<Room | null> {
    return this.rooms.get(id.toString()) || null;
  }

  async findByOwner(ownerId: UserId): Promise<Room[]> {
    return Array.from(this.rooms.values())
      .filter(room => room.owner.equals(ownerId));
  }

  async findPublicRooms(): Promise<Room[]> {
    return Array.from(this.rooms.values())
      .filter(room => !room.settings.isPrivate);
  }

  async findByNamePattern(pattern: string): Promise<Room[]> {
    const regex = new RegExp(pattern, 'i');
    return Array.from(this.rooms.values())
      .filter(room => regex.test(room.name));
  }

  async findWithPagination(offset: number, limit: number): Promise<Room[]> {
    const allRooms = Array.from(this.rooms.values());
    return allRooms.slice(offset, offset + limit);
  }

  async delete(id: RoomId): Promise<void> {
    this.rooms.delete(id.toString());
  }

  // Additional utility methods for testing and debugging
  clear(): void {
    this.rooms.clear();
  }

  size(): number {
    return this.rooms.size;
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}