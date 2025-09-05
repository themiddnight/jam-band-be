/**
 * InMemoryRoomRepository Tests
 * 
 * Tests for the in-memory room repository implementation.
 * Verifies all repository operations work correctly.
 */

import { InMemoryRoomRepository } from '../InMemoryRoomRepository';
import { Room } from '../../../domain/models/Room';
import { RoomSettings } from '../../../domain/models/RoomSettings';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';

describe('InMemoryRoomRepository', () => {
  let repository: InMemoryRoomRepository;
  let testRoom: Room;
  let roomId: RoomId;
  let ownerId: UserId;

  beforeEach(() => {
    repository = new InMemoryRoomRepository();
    roomId = RoomId.generate();
    ownerId = UserId.generate();
    testRoom = Room.create('Test Room', ownerId, RoomSettings.default());
  });

  describe('save and findById', () => {
    it('should save and retrieve a room', async () => {
      await repository.save(testRoom);
      
      const retrieved = await repository.findById(testRoom.id);
      
      expect(retrieved).toBeTruthy();
      expect(retrieved!.id.equals(testRoom.id)).toBe(true);
      expect(retrieved!.name).toBe('Test Room');
      expect(retrieved!.owner.equals(ownerId)).toBe(true);
    });

    it('should return null for non-existent room', async () => {
      const nonExistentId = RoomId.generate();
      
      const result = await repository.findById(nonExistentId);
      
      expect(result).toBeNull();
    });
  });

  describe('findByOwner', () => {
    it('should find rooms by owner', async () => {
      const room1 = Room.create('Room 1', ownerId);
      const room2 = Room.create('Room 2', ownerId);
      const otherOwnerId = UserId.generate();
      const room3 = Room.create('Room 3', otherOwnerId);

      await repository.save(room1);
      await repository.save(room2);
      await repository.save(room3);

      const ownerRooms = await repository.findByOwner(ownerId);
      
      expect(ownerRooms).toHaveLength(2);
      expect(ownerRooms.every(room => room.owner.equals(ownerId))).toBe(true);
    });
  });

  describe('findPublicRooms', () => {
    it('should find only public rooms', async () => {
      const publicRoom = Room.create('Public Room', ownerId, RoomSettings.create({
        isPrivate: false,
        maxMembers: 10,
        allowAudience: true,
        requireApproval: false
      }));
      
      const privateRoom = Room.create('Private Room', ownerId, RoomSettings.create({
        isPrivate: true,
        maxMembers: 10,
        allowAudience: true,
        requireApproval: false
      }));

      await repository.save(publicRoom);
      await repository.save(privateRoom);

      const publicRooms = await repository.findPublicRooms();
      
      expect(publicRooms).toHaveLength(1);
      expect(publicRooms[0]?.name).toBe('Public Room');
    });
  });

  describe('findByNamePattern', () => {
    it('should find rooms matching name pattern', async () => {
      const room1 = Room.create('Jazz Session', ownerId);
      const room2 = Room.create('Rock Jam', ownerId);
      const room3 = Room.create('Classical Practice', ownerId);

      await repository.save(room1);
      await repository.save(room2);
      await repository.save(room3);

      const jazzRooms = await repository.findByNamePattern('jazz');
      const jamRooms = await repository.findByNamePattern('jam');
      
      expect(jazzRooms).toHaveLength(1);
      expect(jazzRooms[0]?.name).toBe('Jazz Session');
      
      expect(jamRooms).toHaveLength(1);
      expect(jamRooms[0]?.name).toBe('Rock Jam');
    });
  });

  describe('findWithPagination', () => {
    it('should return paginated results', async () => {
      // Create 5 rooms
      for (let i = 1; i <= 5; i++) {
        const room = Room.create(`Room ${i}`, ownerId);
        await repository.save(room);
      }

      const firstPage = await repository.findWithPagination(0, 2);
      const secondPage = await repository.findWithPagination(2, 2);
      
      expect(firstPage).toHaveLength(2);
      expect(secondPage).toHaveLength(2);
      
      // Ensure no overlap
      const firstPageIds = firstPage.map(r => r.id.toString());
      const secondPageIds = secondPage.map(r => r.id.toString());
      expect(firstPageIds.some(id => secondPageIds.includes(id))).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a room', async () => {
      await repository.save(testRoom);
      
      // Verify room exists
      let retrieved = await repository.findById(testRoom.id);
      expect(retrieved).toBeTruthy();
      
      // Delete room
      await repository.delete(testRoom.id);
      
      // Verify room is deleted
      retrieved = await repository.findById(testRoom.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('utility methods', () => {
    it('should clear all rooms', async () => {
      await repository.save(testRoom);
      expect(repository.size()).toBe(1);
      
      repository.clear();
      expect(repository.size()).toBe(0);
    });

    it('should return correct size', async () => {
      expect(repository.size()).toBe(0);
      
      await repository.save(testRoom);
      expect(repository.size()).toBe(1);
    });

    it('should return all rooms', async () => {
      const room1 = Room.create('Room 1', ownerId);
      const room2 = Room.create('Room 2', ownerId);
      
      await repository.save(room1);
      await repository.save(room2);
      
      const allRooms = repository.getAllRooms();
      expect(allRooms).toHaveLength(2);
    });
  });
});