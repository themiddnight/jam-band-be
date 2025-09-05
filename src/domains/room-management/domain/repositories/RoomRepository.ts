/**
 * Room repository interface
 */

import { Room } from '../models/Room';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

export interface RoomRepository {
  save(room: Room): Promise<void>;
  findById(id: RoomId): Promise<Room | null>;
  findByOwner(ownerId: UserId): Promise<Room[]>;
  findPublicRooms(): Promise<Room[]>;
  findByNamePattern(pattern: string): Promise<Room[]>;
  findWithPagination(offset: number, limit: number): Promise<Room[]>;
  delete(id: RoomId): Promise<void>;
}