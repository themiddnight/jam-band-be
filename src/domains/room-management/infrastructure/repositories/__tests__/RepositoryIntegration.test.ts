/**
 * Repository Integration Tests
 * 
 * Tests that demonstrate how the repositories work together
 * and can be used in real application scenarios.
 */

import { RepositoryFactory } from '../RepositoryFactory';
import { Room } from '../../../domain/models/Room';
import { User } from '../../../domain/models/User';
import { RoomSettings } from '../../../domain/models/RoomSettings';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';

describe('Repository Integration', () => {
  beforeEach(() => {
    // Reset repositories for each test
    RepositoryFactory.reset();
  });

  it('should create users and rooms and establish relationships', async () => {
    const userRepo = RepositoryFactory.getUserRepository();
    const roomRepo = RepositoryFactory.getRoomRepository();

    // Create users
    const owner = User.create('roomowner');
    const member1 = User.create('member1');
    const member2 = User.create('member2');

    await userRepo.save(owner);
    await userRepo.save(member1);
    await userRepo.save(member2);

    // Create room
    const roomSettings = RoomSettings.create({
      isPrivate: false,
      maxMembers: 10,
      allowAudience: true,
      requireApproval: false
    });
    
    const room = Room.create('Integration Test Room', owner.id, roomSettings);
    await roomRepo.save(room);

    // Verify relationships
    const savedRoom = await roomRepo.findById(room.id);
    const savedOwner = await userRepo.findById(owner.id);

    expect(savedRoom).toBeTruthy();
    expect(savedOwner).toBeTruthy();
    expect(savedRoom!.owner.equals(owner.id)).toBe(true);
    expect(savedOwner!.username).toBe('roomowner');

    // Find rooms by owner
    const ownerRooms = await roomRepo.findByOwner(owner.id);
    expect(ownerRooms).toHaveLength(1);
    expect(ownerRooms[0]?.name).toBe('Integration Test Room');
  });

  it('should handle multiple rooms and users', async () => {
    const userRepo = RepositoryFactory.getUserRepository();
    const roomRepo = RepositoryFactory.getRoomRepository();

    // Create multiple users
    const users = [];
    for (let i = 1; i <= 5; i++) {
      const user = User.create(`user${i}`);
      await userRepo.save(user);
      users.push(user);
    }

    // Create multiple rooms with different owners
    const rooms = [];
    for (let i = 0; i < 3; i++) {
      const user = users[i];
      if (user) {
        const room = Room.create(`Room ${i + 1}`, user.id);
        await roomRepo.save(room);
        rooms.push(room);
      }
    }

    // Verify all users exist
    const allUsers = await userRepo.findAll();
    expect(allUsers).toHaveLength(5);

    // Verify rooms are distributed among owners
    const user1Rooms = await roomRepo.findByOwner(users[0]!.id);
    const user2Rooms = await roomRepo.findByOwner(users[1]!.id);
    const user3Rooms = await roomRepo.findByOwner(users[2]!.id);
    const user4Rooms = await roomRepo.findByOwner(users[3]!.id);

    expect(user1Rooms).toHaveLength(1);
    expect(user2Rooms).toHaveLength(1);
    expect(user3Rooms).toHaveLength(1);
    expect(user4Rooms).toHaveLength(0); // No rooms for user4

    // Find all public rooms
    const publicRooms = await roomRepo.findPublicRooms();
    expect(publicRooms).toHaveLength(3); // All rooms are public by default
  });

  it('should demonstrate repository factory singleton behavior', () => {
    const userRepo1 = RepositoryFactory.getUserRepository();
    const userRepo2 = RepositoryFactory.getUserRepository();
    const roomRepo1 = RepositoryFactory.getRoomRepository();
    const roomRepo2 = RepositoryFactory.getRoomRepository();

    // Should return same instances
    expect(userRepo1).toBe(userRepo2);
    expect(roomRepo1).toBe(roomRepo2);
  });

  it('should allow custom repository implementations', async () => {
    const userRepo = RepositoryFactory.getUserRepository();
    
    // Save a user with default repository
    const user = User.create('testuser');
    await userRepo.save(user);
    
    let retrieved = await userRepo.findById(user.id);
    expect(retrieved).toBeTruthy();

    // Reset and verify user is gone
    RepositoryFactory.reset();
    const newUserRepo = RepositoryFactory.getUserRepository();
    
    retrieved = await newUserRepo.findById(user.id);
    expect(retrieved).toBeNull();
  });
});