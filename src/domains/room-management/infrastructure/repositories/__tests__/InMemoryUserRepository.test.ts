/**
 * InMemoryUserRepository Tests
 * 
 * Tests for the in-memory user repository implementation.
 * Verifies all repository operations work correctly.
 */

import { InMemoryUserRepository } from '../InMemoryUserRepository';
import { User, UserProfile } from '../../../domain/models/User';
import { UserId } from '../../../../../shared/domain/models/ValueObjects';

describe('InMemoryUserRepository', () => {
  let repository: InMemoryUserRepository;
  let testUser: User;
  let userId: UserId;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
    userId = UserId.generate();
    testUser = User.create('testuser', UserProfile.default());
  });

  describe('save and findById', () => {
    it('should save and retrieve a user', async () => {
      await repository.save(testUser);
      
      const retrieved = await repository.findById(testUser.id);
      
      expect(retrieved).toBeTruthy();
      expect(retrieved!.id.equals(testUser.id)).toBe(true);
      expect(retrieved!.username).toBe('testuser');
    });

    it('should return null for non-existent user', async () => {
      const nonExistentId = UserId.generate();
      
      const result = await repository.findById(nonExistentId);
      
      expect(result).toBeNull();
    });
  });

  describe('findByUsername', () => {
    it('should find user by username', async () => {
      await repository.save(testUser);
      
      const retrieved = await repository.findByUsername('testuser');
      
      expect(retrieved).toBeTruthy();
      expect(retrieved!.username).toBe('testuser');
      expect(retrieved!.id.equals(testUser.id)).toBe(true);
    });

    it('should be case insensitive', async () => {
      await repository.save(testUser);
      
      const retrieved = await repository.findByUsername('TESTUSER');
      
      expect(retrieved).toBeTruthy();
      expect(retrieved!.username).toBe('testuser');
    });

    it('should return null for non-existent username', async () => {
      const result = await repository.findByUsername('nonexistent');
      
      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const user1 = User.create('user1');
      const user2 = User.create('user2');
      const user3 = User.create('user3');

      await repository.save(user1);
      await repository.save(user2);
      await repository.save(user3);

      const allUsers = await repository.findAll();
      
      expect(allUsers).toHaveLength(3);
      expect(allUsers.map(u => u.username).sort()).toEqual(['user1', 'user2', 'user3']);
    });
  });

  describe('delete', () => {
    it('should delete a user', async () => {
      await repository.save(testUser);
      
      // Verify user exists
      let retrieved = await repository.findById(testUser.id);
      expect(retrieved).toBeTruthy();
      
      // Delete user
      await repository.delete(testUser.id);
      
      // Verify user is deleted
      retrieved = await repository.findById(testUser.id);
      expect(retrieved).toBeNull();
      
      // Verify username index is also cleaned up
      const byUsername = await repository.findByUsername('testuser');
      expect(byUsername).toBeNull();
    });
  });

  describe('username index management', () => {
    it('should update username index when user is updated', async () => {
      await repository.save(testUser);
      
      // Verify original username works
      let retrieved = await repository.findByUsername('testuser');
      expect(retrieved).toBeTruthy();
      
      // Create updated user with new username
      const updatedProfile = new UserProfile('New Display Name');
      const updatedUser = User.create('newusername', updatedProfile);
      // Simulate updating the same user ID with new username
      const userWithSameId = Object.create(User.prototype);
      Object.assign(userWithSameId, {
        _id: testUser.id,
        _username: 'newusername',
        _profile: updatedProfile,
        _permissions: testUser.permissions,
        _createdAt: testUser.createdAt
      });
      
      await repository.save(userWithSameId);
      
      // Old username should not work
      retrieved = await repository.findByUsername('testuser');
      expect(retrieved).toBeNull();
      
      // New username should work
      retrieved = await repository.findByUsername('newusername');
      expect(retrieved).toBeTruthy();
    });
  });

  describe('utility methods', () => {
    it('should clear all users', async () => {
      await repository.save(testUser);
      expect(repository.size()).toBe(1);
      expect(repository.hasUsername('testuser')).toBe(true);
      
      repository.clear();
      expect(repository.size()).toBe(0);
      expect(repository.hasUsername('testuser')).toBe(false);
    });

    it('should return correct size', async () => {
      expect(repository.size()).toBe(0);
      
      await repository.save(testUser);
      expect(repository.size()).toBe(1);
    });

    it('should check username existence', async () => {
      expect(repository.hasUsername('testuser')).toBe(false);
      
      await repository.save(testUser);
      expect(repository.hasUsername('testuser')).toBe(true);
      expect(repository.hasUsername('TESTUSER')).toBe(true); // Case insensitive
    });

    it('should return all users', async () => {
      const user1 = User.create('user1');
      const user2 = User.create('user2');
      
      await repository.save(user1);
      await repository.save(user2);
      
      const allUsers = repository.getAllUsers();
      expect(allUsers).toHaveLength(2);
    });
  });
});