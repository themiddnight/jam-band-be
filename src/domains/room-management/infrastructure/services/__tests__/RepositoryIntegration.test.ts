/**
 * Repository Integration Tests
 * 
 * Tests the integration between repositories, application services, and the legacy RoomService
 * 
 * Requirements: 1.3, 1.4
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { RoomService } from '../../../../../services/RoomService';
import { RoomSessionManager } from '../../../../../services/RoomSessionManager';
import { RepositoryServiceFactory } from '../RepositoryServiceFactory';
import { RoomServiceBridge } from '../RoomServiceBridge';
import { RoomApplicationService } from '../../../application/RoomApplicationService';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';

describe('Repository Integration', () => {
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let repositoryFactory: RepositoryServiceFactory;
  let roomApplicationService: RoomApplicationService;
  let roomServiceBridge: RoomServiceBridge;

  beforeEach(() => {
    // Initialize services
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    
    // Create a fresh factory instance for each test to avoid singleton issues
    (RepositoryServiceFactory as any).instance = undefined;
    repositoryFactory = RepositoryServiceFactory.getInstance();
    roomApplicationService = repositoryFactory.getRoomApplicationService();
    roomServiceBridge = repositoryFactory.getRoomServiceBridge(roomService);
    
    // Clear repositories for clean test state
    repositoryFactory.getRoomRepository().clear();
    repositoryFactory.getUserRepository().clear();
  });

  describe('RoomServiceBridge', () => {
    it('should sync legacy room to repository', async () => {
      // Create a room using legacy RoomService
      const { room: legacyRoom } = roomService.createRoom(
        'Test Room',
        'testuser',
        'user123',
        false,
        false
      );

      // Sync to repository
      const domainRoom = await roomServiceBridge.syncLegacyRoomToRepository(legacyRoom);

      // Verify domain room properties
      expect(domainRoom.name).toBe('Test Room');
      expect(domainRoom.owner.toString()).toBe('user123');
      expect(domainRoom.settings.isPrivate).toBe(false);
      expect(domainRoom.memberCount).toBe(1); // Owner is automatically added

      // Verify room is in repository
      const roomFromRepo = await repositoryFactory.getRoomRepository().findById(
        RoomId.fromString(legacyRoom.id)
      );
      expect(roomFromRepo).not.toBeNull();
      expect(roomFromRepo!.name).toBe('Test Room');
    });

    it('should get room with fallback to legacy service', async () => {
      // Create a room using legacy RoomService
      const { room: legacyRoom } = roomService.createRoom(
        'Fallback Room',
        'testuser',
        'user456',
        true,
        false
      );

      // Get room through bridge (should fallback and sync)
      const domainRoom = await roomServiceBridge.getRoomWithFallback(legacyRoom.id);

      expect(domainRoom).not.toBeNull();
      expect(domainRoom!.name).toBe('Fallback Room');
      expect(domainRoom!.settings.isPrivate).toBe(true);

      // Verify it's now in repository
      const roomFromRepo = await repositoryFactory.getRoomRepository().findById(
        RoomId.fromString(legacyRoom.id)
      );
      expect(roomFromRepo).not.toBeNull();
    });
  });

  describe('RoomApplicationService Integration', () => {
    it('should create room through application service', async () => {
      // Create room through application service
      const { roomId, room } = await roomApplicationService.createRoom({
        name: 'Domain Room',
        ownerId: 'user789',
        ownerUsername: 'domainuser',
        settings: {
          isPrivate: false,
          maxMembers: 6,
          allowAudience: true
        }
      });

      expect(roomId).toBeDefined();
      expect(room.name).toBe('Domain Room');
      expect(room.settings.maxMembers).toBe(6);

      // Verify room is in repository
      const roomFromRepo = await repositoryFactory.getRoomRepository().findById(
        RoomId.fromString(roomId)
      );
      expect(roomFromRepo).not.toBeNull();
      expect(roomFromRepo!.name).toBe('Domain Room');
    });

    it('should find rooms by owner', async () => {
      const ownerId = 'owner123';
      
      // Create multiple rooms
      await roomApplicationService.createRoom({
        name: 'Room 1',
        ownerId,
        ownerUsername: 'owner'
      });
      
      await roomApplicationService.createRoom({
        name: 'Room 2',
        ownerId,
        ownerUsername: 'owner'
      });

      // Find rooms by owner
      const rooms = await roomApplicationService.getRoomsByOwner(ownerId);
      
      expect(rooms).toHaveLength(2);
      expect(rooms.map(r => r.name).sort()).toEqual(['Room 1', 'Room 2']);
    });

    it('should get public rooms only', async () => {
      // Create public room
      await roomApplicationService.createRoom({
        name: 'Public Room',
        ownerId: 'user1',
        ownerUsername: 'user1',
        settings: { isPrivate: false }
      });

      // Create private room
      await roomApplicationService.createRoom({
        name: 'Private Room',
        ownerId: 'user2',
        ownerUsername: 'user2',
        settings: { isPrivate: true }
      });

      // Get public rooms
      const publicRooms = await roomApplicationService.getPublicRooms();
      
      expect(publicRooms).toHaveLength(1);
      expect(publicRooms[0].name).toBe('Public Room');
    });
  });

  describe('Error Handling', () => {
    it('should handle repository errors gracefully', async () => {
      // Try to get non-existent room
      const room = await roomServiceBridge.getRoomWithFallback('nonexistent');
      expect(room).toBeNull();
    });

    it('should handle invalid room creation', async () => {
      // Try to create room with invalid data
      await expect(roomApplicationService.createRoom({
        name: '', // Empty name should fail
        ownerId: 'user123',
        ownerUsername: 'user'
      })).rejects.toThrow();
    });
  });
});