/**
 * Mock MongoDB room repository for testing
 */

import { Room } from '../../domain/models/Room';
import { RoomRepository } from '../../domain/repositories/RoomRepository';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

export class MongoRoomRepository implements RoomRepository {
  private rooms = new Map<string, Room>();

  async save(room: Room): Promise<void> {
    this.rooms.set(room.id.toString(), room);
  }

  async findById(id: RoomId): Promise<Room | null> {
    return this.rooms.get(id.toString()) || null;
  }

  async findByOwner(ownerId: UserId): Promise<Room[]> {
    return Array.from(this.rooms.values()).filter(room => 
      room.owner.equals(ownerId)
    );
  }

  async findPublicRooms(): Promise<Room[]> {
    return Array.from(this.rooms.values()).filter(room => 
      !room.settings.isPrivate
    );
  }

  async findByNamePattern(pattern: string): Promise<Room[]> {
    return Array.from(this.rooms.values()).filter(room =>
      room.name.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  async findWithPagination(offset: number, limit: number): Promise<Room[]> {
    const allRooms = Array.from(this.rooms.values());
    return allRooms.slice(offset, offset + limit);
  }

  async delete(id: RoomId): Promise<void> {
    this.rooms.delete(id.toString());
  }
}