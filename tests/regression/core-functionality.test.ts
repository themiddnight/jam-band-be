/**
 * Regression Tests - Ensures new features don't break existing functionality
 * These tests should b    it('should add missing effect chains to user', () => {
      // Test default effect chains
      const defaultChains = roomService.getDefaultEffectChains();
      expect(defaultChains).toHaveProperty('virtual_instrument');
      expect(defaultChains).toHaveProperty('audio_voice_input');

      // Test user effect chains initialization
      const user = {
        id: 'test-user',
        username: 'testuser',
        role: 'audience' as const,
        isReady: true
      } as any;
      roomService.ensureUserEffectChains(user);
      
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    }); new features are added
 */
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { testUsers, testRooms, createTestUser, createTestRoom } from '../fixtures/testData';
import { CreateRoomData } from '../../src/types';

describe('Regression Tests', () => {
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;

  beforeAll(async () => {
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
  });

  describe('Core Room Functionality', () => {
    it('should maintain basic room creation functionality', () => {
      // This test ensures room creation still works as expected
      const roomData = roomService.createRoom(
        'Regression Test Room',
        'TestUser',
        'user123',
        false, // isPrivate
        false, // isHidden
        undefined, // description
        'perform' // roomType
      );

      expect(roomData).toHaveProperty('room');
      expect(roomData).toHaveProperty('user');
      expect(roomData).toHaveProperty('session');
      
      expect(roomData.room.name).toBe('Regression Test Room');
      expect(roomData.room.owner).toBe('user123');
      expect(roomData.user.username).toBe('TestUser');
      expect(roomData.user.role).toBe('room_owner');
    });

    it('should maintain room retrieval functionality', () => {
      // Create a room
      const roomData = roomService.createRoom(
        'Retrieval Test Room',
        'retrievalowner',
        'retrieval123'
      );

      // Test room retrieval
      const foundRoom = roomService.getRoom(roomData.room.id);
      expect(foundRoom).toBeDefined();
      expect(foundRoom?.id).toBe(roomData.room.id);
      expect(foundRoom?.name).toBe('Retrieval Test Room');
    });

    it('should maintain room deletion functionality', () => {
      // Create a room
      const roomData = roomService.createRoom(
        'Deletion Test Room',
        'deleteowner',
        'delete123'
      );

      // Verify room exists
      expect(roomService.getRoom(roomData.room.id)).toBeDefined();

      // Delete room
      const deleted = roomService.deleteRoom(roomData.room.id);
      expect(deleted).toBe(true);

      // Verify room is gone
      expect(roomService.getRoom(roomData.room.id)).toBeUndefined();
    });

    it('should maintain user management functionality', () => {
      // Create room
      const roomData = roomService.createRoom(
        'User Management Room',
        'usermgr',
        'usermgr123'
      );

      // Add user
      const newUser = {
        id: 'newuser123',
        username: 'newuser',
        role: 'audience' as const,
        isReady: true
      } as any;

      const addResult = roomService.addUserToRoom(roomData.room.id, newUser);
      expect(addResult).toBe(true);

      // Verify user was added
      const updatedRoom = roomService.getRoom(roomData.room.id);
      expect(updatedRoom?.users.has('newuser123')).toBe(true);

      // Remove user
      const removeResult = roomService.removeUserFromRoom(roomData.room.id, 'newuser123');
      expect(removeResult).toBeDefined(); // Should return the removed user
      expect(removeResult?.id).toBe('newuser123');

      // Verify user was removed
      const finalRoom = roomService.getRoom(roomData.room.id);
      expect(finalRoom?.users.has('newuser123')).toBe(false);
    });
  });

  describe('Effect Chains Functionality', () => {
    it('should maintain effect chains creation and management', () => {
      // Test default effect chains
      const defaultChains = roomService.getDefaultEffectChains();
      expect(defaultChains).toHaveProperty('virtual_instrument');
      expect(defaultChains).toHaveProperty('audio_voice_input');

      // Test user effect chains initialization
      const user = {
        id: 'test-chains-user',
        username: 'chainsuser',
        role: 'audience' as const,
        isReady: true
      } as any;
      roomService.ensureUserEffectChains(user);
      
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });

    it('should not overwrite existing effect chains', () => {
      const existingEffects = [{ id: 'test-effect', type: 'reverb' }];
      const user = {
        id: 'test-user-2',
        username: 'testuser2',
        role: 'audience' as const,
        isReady: true,
        effectChains: {
          virtual_instrument: {
            type: 'virtual_instrument' as const,
            effects: existingEffects
          }
        }
      } as any;

      roomService.ensureUserEffectChains(user);

      expect(user.effectChains?.virtual_instrument.effects).toEqual(existingEffects);
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });
  });

  describe('Data Integrity', () => {
    it('should maintain consistent room state', () => {
      // Create multiple rooms
      const room1 = roomService.createRoom('Room 1', 'owner1', 'owner1');
      const room2 = roomService.createRoom('Room 2', 'owner2', 'owner2');
      const room3 = roomService.createRoom('Room 3', 'owner3', 'owner3');

      // Verify each room is independent
      expect(room1.room.id).not.toBe(room2.room.id);
      expect(room2.room.id).not.toBe(room3.room.id);
      expect(room1.room.owner).toBe('owner1');
      expect(room2.room.owner).toBe('owner2');
      expect(room3.room.owner).toBe('owner3');

      // Verify rooms can be retrieved independently
      expect(roomService.getRoom(room1.room.id)?.name).toBe('Room 1');
      expect(roomService.getRoom(room2.room.id)?.name).toBe('Room 2');
      expect(roomService.getRoom(room3.room.id)?.name).toBe('Room 3');
    });

    it('should maintain user state consistency across rooms', () => {
      const room1 = roomService.createRoom('Multi Room 1', 'multiowner1', 'multi1');
      const room2 = roomService.createRoom('Multi Room 2', 'multiowner2', 'multi2');

      const user = {
        id: 'multiuser',
        username: 'multiuser',
        role: 'audience' as const,
        isReady: true
      } as any;

      // Add user to both rooms
      roomService.addUserToRoom(room1.room.id, user);
      roomService.addUserToRoom(room2.room.id, user);

      // Verify user exists in both rooms
      const updatedRoom1 = roomService.getRoom(room1.room.id);
      const updatedRoom2 = roomService.getRoom(room2.room.id);

      expect(updatedRoom1?.users.has('multiuser')).toBe(true);
      expect(updatedRoom2?.users.has('multiuser')).toBe(true);

      // Remove user from one room
      roomService.removeUserFromRoom(room1.room.id, 'multiuser');

      // Verify user only removed from one room
      const finalRoom1 = roomService.getRoom(room1.room.id);
      const finalRoom2 = roomService.getRoom(room2.room.id);

      expect(finalRoom1?.users.has('multiuser')).toBe(false);
      expect(finalRoom2?.users.has('multiuser')).toBe(true);
    });
  });

  describe('Performance Regression', () => {
    it('should maintain acceptable room creation performance', async () => {
      const measurements: number[] = [];
      const roomCount = 10;

      for (let i = 0; i < roomCount; i++) {
        const startTime = performance.now();
        const roomData = roomService.createRoom(
          `Performance Room ${i}`,
          `perfowner${i}`,
          `perfowner${i}`
        );
        const endTime = performance.now();
        const duration = endTime - startTime;
        measurements.push(duration);
        expect(roomData).toBeDefined(); // Use the roomData variable
      }

      const averageTime = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const maxTime = Math.max(...measurements);

      // These thresholds should be adjusted based on your performance requirements
      expect(averageTime).toBeLessThan(10); // 10ms average
      expect(maxTime).toBeLessThan(50); // 50ms max
    });

    it('should maintain acceptable user addition performance', async () => {
      const room = roomService.createRoom('Perf Test Room', 'perfowner', 'perfowner');
      const userCount = 20;

      const startTime = performance.now();
      for (let i = 0; i < userCount; i++) {
        const user = {
          id: `perfuser${i}`,
          username: `perfuser${i}`,
          role: 'audience' as const,
          isReady: true
        } as any;
        roomService.addUserToRoom(room.room.id, user);
      }
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should be able to add 20 users in under 100ms
      expect(duration).toBeLessThan(100);

      // Verify all users were added
      const finalRoom = roomService.getRoom(room.room.id);
      expect(finalRoom?.users.size).toBe(userCount + 1); // +1 for owner
    });
  });

  describe('Error Handling Regression', () => {
    it('should maintain graceful error handling for invalid operations', () => {
      // Test invalid room retrieval
      expect(roomService.getRoom('invalid-id')).toBeUndefined();

      // Test invalid room deletion
      expect(roomService.deleteRoom('invalid-id')).toBe(false);

      // Test adding user to invalid room
      const user = {
        id: 'invalid-user',
        username: 'invaliduser',
        role: 'audience' as const,
        isReady: true
      } as any;
      expect(roomService.addUserToRoom('invalid-id', user)).toBe(false);
    });

    it('should handle edge cases consistently', () => {
      // Test creating room with edge case names
      const edgeCaseRoom1 = roomService.createRoom('', 'owner', 'owner1'); // Empty name
      const edgeCaseRoom2 = roomService.createRoom('  ', 'owner', 'owner2'); // Whitespace name
      const edgeCaseRoom3 = roomService.createRoom('A'.repeat(1000), 'owner', 'owner3'); // Very long name

      // Should handle these gracefully (implementation dependent)
      expect(edgeCaseRoom1.room).toBeDefined();
      expect(edgeCaseRoom2.room).toBeDefined();
      expect(edgeCaseRoom3.room).toBeDefined();
    });
  });

  describe('API Contract Stability', () => {
    it('should maintain stable return types for room creation', () => {
      const result = roomService.createRoom('Contract Test', 'owner', 'owner123');

      // Verify return structure hasn't changed
      expect(result).toHaveProperty('room');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('session');

      // Verify room properties
      expect(result.room).toHaveProperty('id');
      expect(result.room).toHaveProperty('name');
      expect(result.room).toHaveProperty('owner');
      expect(result.room).toHaveProperty('users');
      expect(result.room).toHaveProperty('isPrivate');
      expect(result.room).toHaveProperty('createdAt');

      // Verify user properties
      expect(result.user).toHaveProperty('id');
      expect(result.user).toHaveProperty('username');
      expect(result.user).toHaveProperty('role');
      expect(result.user).toHaveProperty('isReady');
    });

    it('should maintain stable method signatures', () => {
      // Verify method exists and accepts expected parameters
      expect(typeof roomService.createRoom).toBe('function');
      expect(typeof roomService.getRoom).toBe('function');
      expect(typeof roomService.deleteRoom).toBe('function');
      expect(typeof roomService.addUserToRoom).toBe('function');
      expect(typeof roomService.removeUserFromRoom).toBe('function');
      expect(typeof roomService.ensureUserEffectChains).toBe('function');
      expect(typeof roomService.getDefaultEffectChains).toBe('function');

      // Test that methods can be called without errors
      const room = roomService.createRoom('Signature Test', 'sigowner', 'sig123');
      expect(() => roomService.getRoom(room.room.id)).not.toThrow();
      expect(() => roomService.deleteRoom(room.room.id)).not.toThrow();
    });
  });
});