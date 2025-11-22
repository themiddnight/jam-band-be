/**
 * Arrange Room Regression Tests
 * Ensures that Arrange Room features don't break existing Perform Room functionality
 * and maintains backward compatibility
 */
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { ArrangeRoomStateService } from '../../src/services/ArrangeRoomStateService';
import { createTestTrack } from '../fixtures/arrangeRoomTestData';

describe('Arrange Room Regression Tests', () => {
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let arrangeRoomStateService: ArrangeRoomStateService;

  beforeAll(async () => {
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    arrangeRoomStateService = new ArrangeRoomStateService();
  });

  afterEach(() => {
    // Clean up all rooms
    const rooms = roomService.getAllRooms();
    rooms.forEach(room => roomService.deleteRoom(room.id));
  });

  describe('Room Type Coexistence', () => {
    it('should maintain perform room functionality when arrange rooms exist', () => {
      // Create perform room
      const performRoom = roomService.createRoom(
        'Perform Room',
        'PerformOwner',
        'perform-owner-1',
        false,
        false,
        undefined,
        'perform'
      );

      // Create arrange room
      const arrangeRoom = roomService.createRoom(
        'Arrange Room',
        'ArrangeOwner',
        'arrange-owner-1',
        false,
        false,
        undefined,
        'arrange'
      );

      // Verify both rooms exist independently
      expect(performRoom.room.roomType).toBe('perform');
      expect(arrangeRoom.room.roomType).toBe('arrange');
      expect(performRoom.room.id).not.toBe(arrangeRoom.room.id);

      // Verify perform room can be retrieved
      const foundPerformRoom = roomService.getRoom(performRoom.room.id);
      expect(foundPerformRoom).toBeDefined();
      expect(foundPerformRoom?.roomType).toBe('perform');

      // Verify arrange room can be retrieved
      const foundArrangeRoom = roomService.getRoom(arrangeRoom.room.id);
      expect(foundArrangeRoom).toBeDefined();
      expect(foundArrangeRoom?.roomType).toBe('arrange');
    });

    it('should handle users in both room types simultaneously', () => {
      const performRoom = roomService.createRoom(
        'Perform Room',
        'owner1',
        'owner1',
        false,
        false,
        undefined,
        'perform'
      );

      const arrangeRoom = roomService.createRoom(
        'Arrange Room',
        'owner2',
        'owner2',
        false,
        false,
        undefined,
        'arrange'
      );

      const user = {
        id: 'multi-user',
        username: 'multiuser',
        role: 'band_member' as const,
        isReady: true,
      } as any;

      // Add user to both rooms
      roomService.addUserToRoom(performRoom.room.id, user);
      roomService.addUserToRoom(arrangeRoom.room.id, user);

      const updatedPerformRoom = roomService.getRoom(performRoom.room.id);
      const updatedArrangeRoom = roomService.getRoom(arrangeRoom.room.id);

      expect(updatedPerformRoom?.users.has('multi-user')).toBe(true);
      expect(updatedArrangeRoom?.users.has('multi-user')).toBe(true);
    });

    it('should maintain separate room lists by type', () => {
      // Create multiple rooms of each type
      roomService.createRoom('Perform 1', 'owner1', 'owner1', false, false, undefined, 'perform');
      roomService.createRoom('Perform 2', 'owner2', 'owner2', false, false, undefined, 'perform');
      roomService.createRoom('Arrange 1', 'owner3', 'owner3', false, false, undefined, 'arrange');
      roomService.createRoom('Arrange 2', 'owner4', 'owner4', false, false, undefined, 'arrange');

      const allRooms = roomService.getAllRooms();
      const performRooms = allRooms.filter(r => r.roomType === 'perform');
      const arrangeRooms = allRooms.filter(r => r.roomType === 'arrange');

      expect(performRooms).toHaveLength(2);
      expect(arrangeRooms).toHaveLength(2);
      expect(allRooms).toHaveLength(4);
    });
  });

  describe('Core Room Functionality Preservation', () => {
    it('should maintain basic room creation for perform rooms', () => {
      const roomData = roomService.createRoom(
        'Legacy Perform Room',
        'LegacyUser',
        'legacy-123',
        false,
        false,
        undefined,
        'perform'
      );

      expect(roomData).toHaveProperty('room');
      expect(roomData).toHaveProperty('user');
      expect(roomData).toHaveProperty('session');
      expect(roomData.room.name).toBe('Legacy Perform Room');
      expect(roomData.room.owner).toBe('legacy-123');
      expect(roomData.user.role).toBe('room_owner');
    });

    it('should maintain room retrieval functionality', () => {
      const performRoom = roomService.createRoom(
        'Perform Room',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        'perform'
      );

      const arrangeRoom = roomService.createRoom(
        'Arrange Room',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        'arrange'
      );

      expect(roomService.getRoom(performRoom.room.id)).toBeDefined();
      expect(roomService.getRoom(arrangeRoom.room.id)).toBeDefined();
    });

    it('should maintain room deletion functionality', () => {
      const performRoom = roomService.createRoom(
        'Delete Perform',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        'perform'
      );

      const arrangeRoom = roomService.createRoom(
        'Delete Arrange',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        'arrange'
      );

      roomService.deleteRoom(performRoom.room.id);
      roomService.deleteRoom(arrangeRoom.room.id);

      expect(roomService.getRoom(performRoom.room.id)).toBeUndefined();
      expect(roomService.getRoom(arrangeRoom.room.id)).toBeUndefined();
    });

    it('should maintain user management functionality', () => {
      const performRoom = roomService.createRoom(
        'User Mgmt Perform',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        'perform'
      );

      const arrangeRoom = roomService.createRoom(
        'User Mgmt Arrange',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        'arrange'
      );

      const user = {
        id: 'test-user',
        username: 'testuser',
        role: 'band_member' as const,
        isReady: true,
      } as any;

      // Test adding to perform room
      expect(roomService.addUserToRoom(performRoom.room.id, user)).toBe(true);
      expect(roomService.getRoom(performRoom.room.id)?.users.has('test-user')).toBe(true);

      // Test adding to arrange room
      expect(roomService.addUserToRoom(arrangeRoom.room.id, user)).toBe(true);
      expect(roomService.getRoom(arrangeRoom.room.id)?.users.has('test-user')).toBe(true);
    });
  });

  describe('Effect Chains Compatibility', () => {
    it('should maintain effect chains for perform rooms', () => {
      const performRoom = roomService.createRoom(
        'Effects Perform',
        'owner',
        'owner-effects',
        false,
        false,
        undefined,
        'perform'
      );

      const user = performRoom.user;
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });

    it('should maintain effect chains for arrange rooms', () => {
      const arrangeRoom = roomService.createRoom(
        'Effects Arrange',
        'owner',
        'owner-effects-arrange',
        false,
        false,
        undefined,
        'arrange'
      );

      const user = arrangeRoom.user;
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });

    it('should not interfere with effect chains between room types', () => {
      const performRoom = roomService.createRoom(
        'Perform Effects',
        'owner1',
        'owner1',
        false,
        false,
        undefined,
        'perform'
      );

      const arrangeRoom = roomService.createRoom(
        'Arrange Effects',
        'owner2',
        'owner2',
        false,
        false,
        undefined,
        'arrange'
      );

      expect(performRoom.user.effectChains).toBeDefined();
      expect(arrangeRoom.user.effectChains).toBeDefined();
      expect(performRoom.user.id).not.toBe(arrangeRoom.user.id);
    });
  });

  describe('Data Integrity', () => {
    it('should maintain consistent room state across types', () => {
      const performRoom = roomService.createRoom('Perform', 'owner1', 'owner1', false, false, undefined, 'perform');
      const arrangeRoom = roomService.createRoom('Arrange', 'owner2', 'owner2', false, false, undefined, 'arrange');

      expect(performRoom.room.id).not.toBe(arrangeRoom.room.id);
      expect(performRoom.room.owner).toBe('owner1');
      expect(arrangeRoom.room.owner).toBe('owner2');
      expect(performRoom.room.users.size).toBe(1);
      expect(arrangeRoom.room.users.size).toBe(1);
    });

    it('should not leak arrange room state into perform rooms', () => {
      const performRoom = roomService.createRoom(
        'Perform Room',
        'owner',
        'owner-1',
        false,
        false,
        undefined,
        'perform'
      );

      const arrangeRoom = roomService.createRoom(
        'Arrange Room',
        'owner',
        'owner-2',
        false,
        false,
        undefined,
        'arrange'
      );

      arrangeRoomStateService.initializeState(arrangeRoom.room.id);
      arrangeRoomStateService.addTrack(arrangeRoom.room.id, createTestTrack({ id: 'track-1', name: 'Test Track' }));

      // Verify arrange room has state
      const arrangeState = arrangeRoomStateService.getState(arrangeRoom.room.id);
      expect(arrangeState?.tracks).toHaveLength(1);

      // Verify perform room has no arrange state
      const performState = arrangeRoomStateService.getState(performRoom.room.id);
      expect(performState).toBeUndefined();
    });

    it('should maintain user state consistency across room types', () => {
      const performRoom = roomService.createRoom('Perform', 'owner1', 'owner1', false, false, undefined, 'perform');
      const arrangeRoom = roomService.createRoom('Arrange', 'owner2', 'owner2', false, false, undefined, 'arrange');

      const user = {
        id: 'shared-user',
        username: 'shareduser',
        role: 'band_member' as const,
        isReady: true,
      } as any;

      roomService.addUserToRoom(performRoom.room.id, user);
      roomService.addUserToRoom(arrangeRoom.room.id, user);

      // Remove from perform room
      roomService.removeUserFromRoom(performRoom.room.id, 'shared-user');

      // Verify still in arrange room
      expect(roomService.getRoom(performRoom.room.id)?.users.has('shared-user')).toBe(false);
      expect(roomService.getRoom(arrangeRoom.room.id)?.users.has('shared-user')).toBe(true);
    });
  });

  describe('Performance Regression', () => {
    it('should maintain acceptable room creation performance', () => {
      const measurements: number[] = [];
      const roomCount = 10;

      for (let i = 0; i < roomCount; i++) {
        const startTime = performance.now();
        const roomType = i % 2 === 0 ? 'perform' : 'arrange';
        const roomData = roomService.createRoom(
          `Room ${i}`,
          `owner${i}`,
          `owner${i}`,
          false,
          false,
          undefined,
          roomType as 'perform' | 'arrange'
        );
        const endTime = performance.now();
        
        measurements.push(endTime - startTime);
        expect(roomData).toBeDefined();
      }

      const averageTime = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      expect(averageTime).toBeLessThan(15); // 15ms average
    });

    it('should handle mixed room operations efficiently', () => {
      const performRoom = roomService.createRoom('Perform', 'owner1', 'owner1', false, false, undefined, 'perform');
      const arrangeRoom = roomService.createRoom('Arrange', 'owner2', 'owner2', false, false, undefined, 'arrange');

      const startTime = performance.now();

      // Perform multiple operations
      for (let i = 0; i < 20; i++) {
        const user = {
          id: `user-${i}`,
          username: `user${i}`,
          role: 'audience' as const,
          isReady: true,
        } as any;

        const targetRoom = i % 2 === 0 ? performRoom.room.id : arrangeRoom.room.id;
        roomService.addUserToRoom(targetRoom, user);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100); // Should complete in under 100ms
      expect(roomService.getRoom(performRoom.room.id)?.users.size).toBe(11); // 10 users + owner
      expect(roomService.getRoom(arrangeRoom.room.id)?.users.size).toBe(11); // 10 users + owner
    });
  });

  describe('API Contract Stability', () => {
    it('should maintain stable return types for room creation', () => {
      const performResult = roomService.createRoom('Perform', 'owner', 'owner1', false, false, undefined, 'perform');
      const arrangeResult = roomService.createRoom('Arrange', 'owner', 'owner2', false, false, undefined, 'arrange');

      // Verify both have same structure
      expect(performResult).toHaveProperty('room');
      expect(performResult).toHaveProperty('user');
      expect(performResult).toHaveProperty('session');

      expect(arrangeResult).toHaveProperty('room');
      expect(arrangeResult).toHaveProperty('user');
      expect(arrangeResult).toHaveProperty('session');

      // Verify room properties
      expect(performResult.room).toHaveProperty('id');
      expect(performResult.room).toHaveProperty('name');
      expect(performResult.room).toHaveProperty('roomType');
      expect(performResult.room.roomType).toBe('perform');

      expect(arrangeResult.room).toHaveProperty('id');
      expect(arrangeResult.room).toHaveProperty('name');
      expect(arrangeResult.room).toHaveProperty('roomType');
      expect(arrangeResult.room.roomType).toBe('arrange');
    });

    it('should maintain backward compatible method signatures', () => {
      // Verify methods exist and work for both room types
      expect(typeof roomService.createRoom).toBe('function');
      expect(typeof roomService.getRoom).toBe('function');
      expect(typeof roomService.deleteRoom).toBe('function');
      expect(typeof roomService.addUserToRoom).toBe('function');
      expect(typeof roomService.removeUserFromRoom).toBe('function');

      // Test that methods work for both room types
      const performRoom = roomService.createRoom('Perform', 'owner', 'owner1', false, false, undefined, 'perform');
      const arrangeRoom = roomService.createRoom('Arrange', 'owner', 'owner2', false, false, undefined, 'arrange');

      expect(() => roomService.getRoom(performRoom.room.id)).not.toThrow();
      expect(() => roomService.getRoom(arrangeRoom.room.id)).not.toThrow();
      expect(() => roomService.deleteRoom(performRoom.room.id)).not.toThrow();
      expect(() => roomService.deleteRoom(arrangeRoom.room.id)).not.toThrow();
    });
  });

  describe('Error Handling Consistency', () => {
    it('should handle errors consistently across room types', () => {
      // Test invalid room retrieval
      expect(roomService.getRoom('invalid-perform-id')).toBeUndefined();
      expect(roomService.getRoom('invalid-arrange-id')).toBeUndefined();

      // Test invalid room deletion
      expect(roomService.deleteRoom('invalid-perform-id')).toBe(false);
      expect(roomService.deleteRoom('invalid-arrange-id')).toBe(false);
    });

    it('should handle edge cases consistently', () => {
      // Empty name
      const emptyPerform = roomService.createRoom('', 'owner', 'owner1', false, false, undefined, 'perform');
      const emptyArrange = roomService.createRoom('', 'owner', 'owner2', false, false, undefined, 'arrange');

      expect(emptyPerform.room).toBeDefined();
      expect(emptyArrange.room).toBeDefined();

      // Very long name
      const longName = 'A'.repeat(1000);
      const longPerform = roomService.createRoom(longName, 'owner', 'owner3', false, false, undefined, 'perform');
      const longArrange = roomService.createRoom(longName, 'owner', 'owner4', false, false, undefined, 'arrange');

      expect(longPerform.room).toBeDefined();
      expect(longArrange.room).toBeDefined();
    });
  });

  describe('Room Settings Compatibility', () => {
    it('should maintain room privacy settings across types', () => {
      const privatePerform = roomService.createRoom('Private Perform', 'owner', 'owner1', true, false, undefined, 'perform');
      const privateArrange = roomService.createRoom('Private Arrange', 'owner', 'owner2', true, false, undefined, 'arrange');

      expect(privatePerform.room.isPrivate).toBe(true);
      expect(privateArrange.room.isPrivate).toBe(true);
    });

    it('should maintain room hidden settings across types', () => {
      const hiddenPerform = roomService.createRoom('Hidden Perform', 'owner', 'owner1', false, true, undefined, 'perform');
      const hiddenArrange = roomService.createRoom('Hidden Arrange', 'owner', 'owner2', false, true, undefined, 'arrange');

      expect(hiddenPerform.room.isHidden).toBe(true);
      expect(hiddenArrange.room.isHidden).toBe(true);
    });

    it('should maintain room description across types', () => {
      const description = 'Test room description';
      const performRoom = roomService.createRoom('Perform', 'owner', 'owner1', false, false, description, 'perform');
      const arrangeRoom = roomService.createRoom('Arrange', 'owner', 'owner2', false, false, description, 'arrange');

      expect(performRoom.room.description).toBe(description);
      expect(arrangeRoom.room.description).toBe(description);
    });
  });
});
