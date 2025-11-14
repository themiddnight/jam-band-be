/**
 * Integration Tests for Room Management Flow
 * Tests the complete room lifecycle with real services working together
 */
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { CreateRoomData } from '../../src/types';

describe('Room Management Integration Tests', () => {
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;

  beforeAll(async () => {
    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);

    // Clean test environment (testUtils is globally available via setup.ts)
  });

  afterAll(async () => {
    // Cleanup after tests (testUtils is globally available via setup.ts)
  });

  describe('Room Creation and Management', () => {
    it('should create a room successfully', async () => {
      const roomData = roomService.createRoom(
        'Integration Test Room',
        'IntegrationUser',
        'integration-user-123',
        false, // isPrivate
        false, // isHidden
        undefined, // description
        'perform' // roomType
      );
      
      expect(roomData.room).toBeDefined();
      expect(roomData.user).toBeDefined();
      expect(roomData.room.users.size).toBe(1);
      expect(roomData.room.name).toBe('Integration Test Room');
      expect(roomData.room.owner).toBe('integration-user-123');
      expect(roomData.user.username).toBe('IntegrationUser');
      expect(roomData.user.role).toBe('room_owner');

      // Step 2: Verify room state
      const foundRoom = roomService.getRoom(roomData.room.id);
      expect(foundRoom).toBeDefined();
      expect(foundRoom?.id).toBe(roomData.room.id);
      expect(foundRoom?.users.has('integration-user-123')).toBe(true);

      // Step 3: Test user joining
      const newUser = {
        id: 'user456',
        username: 'testuser',
        role: 'audience' as const,
        isReady: true
      } as any;

      // Test adding user to room
      const addUserResult = roomService.addUserToRoom(roomData.room.id, newUser);
      expect(addUserResult).toBe(true);
      
      // Verify user was added by getting the room again
      const updatedRoom = roomService.getRoom(roomData.room.id);
      expect(updatedRoom).toBeDefined();
      expect(updatedRoom?.users.size).toBe(2);
      expect(updatedRoom?.users.has('user456')).toBe(true);
    });

    it('should handle multiple users in room operations', async () => {
      // Create room
      const roomData = roomService.createRoom(
        'Multi-user Test Room',
        'owner',
        'owner789'
      );

      // Add multiple users
      const userIds = ['user1', 'user2', 'user3'];
        const users = userIds.map(id => ({
          id,
          username: `user-${id}`,
          role: 'audience' as const,
          isReady: true
        }) as any);      // Add users to room
      for (const user of users) {
        const addResult = roomService.addUserToRoom(roomData.room.id, user);
        expect(addResult).toBe(true);
      }

      // Verify final state by getting the room
      const finalRoom = roomService.getRoom(roomData.room.id);
      expect(finalRoom).toBeDefined();
      expect(finalRoom?.users.size).toBe(4); // 3 users + 1 owner
      userIds.forEach(userId => {
        expect(finalRoom?.users.has(userId)).toBe(true);
      });
    });
  });

  describe('Room State Management', () => {
    it('should maintain consistent room state across operations', async () => {
      // Create room
      const roomData = roomService.createRoom(
        'State Test Room',
        'stateowner',
        'state123'
      );

      const roomId = roomData.room.id;

      // Test room exists
      const foundRoom = roomService.getRoom(roomId);
      expect(foundRoom).toBeDefined();
      expect(foundRoom?.id).toBe(roomId);
      expect(foundRoom?.users.size).toBe(1);

      // Test room listing
      const rooms = roomService.getAllRooms();
      expect(rooms.some(room => room.id === roomId)).toBe(true);
    });

    it('should handle room deletion properly', async () => {
      // Create room
      const roomData = roomService.createRoom(
        'Deletion Test Room',
        'deleteowner',
        'delete123'
      );

      const roomId = roomData.room.id;

      // Verify room exists
      expect(roomService.getRoom(roomId)).toBeDefined();

      // Delete room
      const deleted = roomService.deleteRoom(roomId);
      expect(deleted).toBe(true);

      // Verify room is gone
      expect(roomService.getRoom(roomId)).toBeUndefined();
    });
  });

  describe('Room Settings and Configuration', () => {
    it('should create room with different configurations', async () => {
      // Test private room
      const privateRoom = roomService.createRoom(
        'Private Room',
        'privateowner',
        'private123',
        true, // isPrivate
        false,
        'Private room for testing'
      );

      expect(privateRoom.room.isPrivate).toBe(true);
      expect(privateRoom.room.isHidden).toBe(false);

      // Test hidden room
      const hiddenRoom = roomService.createRoom(
        'Hidden Room',
        'hiddenowner',
        'hidden123',
        false,
        true, // isHidden
        'Hidden room for testing'
      );

      expect(hiddenRoom.room.isPrivate).toBe(false);
      expect(hiddenRoom.room.isHidden).toBe(true);

      // Test Arrange room type
      const arrangeRoom = roomService.createRoom(
        'Arrange Room',
        'arrangeowner',
        'arrange123',
        false,
        false,
        'Arrange room for testing',
        'arrange'
      );

      expect(arrangeRoom.room.roomType).toBe('arrange');
    });

    it('should handle effect chains properly', async () => {
      // Create room
      const roomData = roomService.createRoom(
        'Effects Room',
        'effectowner',
        'effect123'
      );

      // Check that user has effect chains
      const user = roomData.user;
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
      
      // Test ensureUserEffectChains function
      const testUser = {
        id: 'effect-user',
        username: 'effectuser',
        role: 'audience' as const,
        isReady: true
      } as any;
      roomService.ensureUserEffectChains(testUser);
      
      expect(testUser.effectChains).toBeDefined();
      expect(testUser.effectChains).toHaveProperty('virtual_instrument');
      expect(testUser.effectChains).toHaveProperty('audio_voice_input');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room operations gracefully', async () => {
      // Test getting non-existent room
      const nonExistentRoom = roomService.getRoom('non-existent-id');
      expect(nonExistentRoom).toBeUndefined();

      // Test deleting non-existent room
      const deleteResult = roomService.deleteRoom('non-existent-id');
      expect(deleteResult).toBe(false);

      // Test adding user to non-existent room
      const testUser = {
        id: 'test-user',
        username: 'testuser',
        role: 'audience' as const,
        isReady: true
      } as any;
      const addResult = roomService.addUserToRoom('non-existent-id', testUser);
      expect(addResult).toBe(false); // Should return false, not undefined
    });
  });

  describe('Performance Tests', () => {
    it('should handle room creation under load', async () => {
      const roomCount = 10;
      const createPromises: Promise<any>[] = [];

      await (global as any).testUtils.measurePerformance('multiple room creation', async () => {
        for (let i = 0; i < roomCount; i++) {
          const promise = new Promise<any>((resolve) => {
            const roomData = roomService.createRoom(
              `Load Test Room ${i}`,
              `owner${i}`,
              `owner${i}`
            );
            resolve(roomData);
          });
          createPromises.push(promise);
        }

        const results = await Promise.all(createPromises);
        expect(results).toHaveLength(roomCount);
        results.forEach(result => {
          expect(result.room).toBeDefined();
          expect(result.user).toBeDefined();
        });

        return results;
      });
    });

    it('should handle user operations efficiently', async () => {
      // Create base room
      const roomData = roomService.createRoom(
        'Performance Room',
        'perfowner',
        'perf123'
      );

      const userCount = 20;
      
      await (global as any).testUtils.measurePerformance('adding multiple users', async () => {
        for (let i = 0; i < userCount; i++) {
          const user = {
            id: `perfuser${i}`,
            username: `perfuser${i}`,
            role: 'audience' as const,
            isReady: true
          } as any;
          
          const addResult = roomService.addUserToRoom(roomData.room.id, user);
          expect(addResult).toBe(true);
        }

        // Verify final state
        const finalRoom = roomService.getRoom(roomData.room.id);
        expect(finalRoom?.users.size).toBe(userCount + 1); // +1 for owner
        return finalRoom;
      });
    });
  });
});