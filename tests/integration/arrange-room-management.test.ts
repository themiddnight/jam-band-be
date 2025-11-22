/**
 * Integration Tests for Arrange Room Management
 * Tests the complete arrange room lifecycle with DAW features
 */
import { RoomService } from '../../src/services/RoomService';
import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { ArrangeRoomStateService } from '../../src/services/ArrangeRoomStateService';
import { createTestTrack, createTestMidiRegion, createTestAudioRegion } from '../fixtures/arrangeRoomTestData';

describe('Arrange Room Management Integration Tests', () => {
  let roomService: RoomService;
  let roomSessionManager: RoomSessionManager;
  let arrangeRoomStateService: ArrangeRoomStateService;

  beforeAll(async () => {
    roomSessionManager = new RoomSessionManager();
    roomService = new RoomService(roomSessionManager);
    arrangeRoomStateService = new ArrangeRoomStateService();
  });

  afterEach(() => {
    // Clean up arrange room states
    const rooms = roomService.getAllRooms();
    rooms.forEach(room => {
      if (room.roomType === 'arrange') {
        roomService.deleteRoom(room.id);
      }
    });
  });

  describe('Arrange Room Creation and Management', () => {
    it('should create an arrange room successfully', async () => {
      const roomData = roomService.createRoom(
        'Production Room',
        'Producer',
        'producer-123',
        false,
        false,
        'DAW collaboration room',
        'arrange'
      );
      
      expect(roomData.room).toBeDefined();
      expect(roomData.user).toBeDefined();
      expect(roomData.room.roomType).toBe('arrange');
      expect(roomData.room.name).toBe('Production Room');
      expect(roomData.room.owner).toBe('producer-123');
      expect(roomData.user.username).toBe('Producer');
      expect(roomData.user.role).toBe('room_owner');
    });

    it('should initialize arrange room state on creation', async () => {
      const roomData = roomService.createRoom(
        'DAW Room',
        'Owner',
        'owner-456',
        false,
        false,
        undefined,
        'arrange'
      );

      arrangeRoomStateService.initializeState(roomData.room.id);
      const state = arrangeRoomStateService.getState(roomData.room.id);

      expect(state).toBeDefined();
      expect(state?.tracks).toEqual([]);
      expect(state?.regions).toEqual([]);
      expect(state?.locks).toBeInstanceOf(Map);
      expect(state?.bpm).toBe(120);
      expect(state?.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    });

    it('should handle multiple users in arrange room', async () => {
      const roomData = roomService.createRoom(
        'Collab Room',
        'owner',
        'owner-789',
        false,
        false,
        undefined,
        'arrange'
      );

      const users = [
        { id: 'user1', username: 'Producer1', role: 'band_member' as const, isReady: true },
        { id: 'user2', username: 'Producer2', role: 'band_member' as const, isReady: true },
        { id: 'user3', username: 'Listener', role: 'audience' as const, isReady: true },
      ] as any[];

      users.forEach(user => {
        const addResult = roomService.addUserToRoom(roomData.room.id, user);
        expect(addResult).toBe(true);
      });

      const finalRoom = roomService.getRoom(roomData.room.id);
      expect(finalRoom?.users.size).toBe(4); // 3 users + 1 owner
    });
  });

  describe('Track Management', () => {
    let roomId: string;

    beforeEach(() => {
      const roomData = roomService.createRoom(
        'Track Test Room',
        'owner',
        'owner-track',
        false,
        false,
        undefined,
        'arrange'
      );
      roomId = roomData.room.id;
      arrangeRoomStateService.initializeState(roomId);
    });

    it('should add tracks to arrange room', () => {
      const track = createTestTrack({ id: 'track-1', name: 'Piano Track' });

      arrangeRoomStateService.addTrack(roomId, track);
      const state = arrangeRoomStateService.getState(roomId);

      expect(state?.tracks).toHaveLength(1);
      expect(state?.tracks[0]?.id).toBe('track-1');
      expect(state?.tracks[0]?.name).toBe('Piano Track');
    });

    it('should update track properties', () => {
      const track = createTestTrack({ id: 'track-1', name: 'Original Name' });

      arrangeRoomStateService.addTrack(roomId, track);
      arrangeRoomStateService.updateTrack(roomId, 'track-1', {
        name: 'Updated Name',
        volume: 0.5,
        mute: true,
      });

      const state = arrangeRoomStateService.getState(roomId);
      const updatedTrack = state?.tracks.find(t => t.id === 'track-1');

      expect(updatedTrack?.name).toBe('Updated Name');
      expect(updatedTrack?.volume).toBe(0.5);
      expect(updatedTrack?.mute).toBe(true);
    });

    it('should remove tracks', () => {
      const track1 = createTestTrack({ id: 'track-1', name: 'Track 1' });
      const track2 = createTestTrack({ id: 'track-2', name: 'Track 2', instrumentId: 'drums' });

      arrangeRoomStateService.addTrack(roomId, track1);
      arrangeRoomStateService.addTrack(roomId, track2);
      arrangeRoomStateService.removeTrack(roomId, 'track-1');

      const state = arrangeRoomStateService.getState(roomId);
      expect(state?.tracks).toHaveLength(1);
      expect(state?.tracks[0]?.id).toBe('track-2');
    });

    it('should reorder tracks', () => {
      const tracks = [
        createTestTrack({ id: 'track-1', name: 'Track 1' }),
        createTestTrack({ id: 'track-2', name: 'Track 2', instrumentId: 'drums' }),
        createTestTrack({ id: 'track-3', name: 'Track 3', instrumentId: 'bass' }),
      ];

      tracks.forEach(track => arrangeRoomStateService.addTrack(roomId, track));
      arrangeRoomStateService.reorderTracks(roomId, ['track-3', 'track-1', 'track-2']);

      const state = arrangeRoomStateService.getState(roomId);
      expect(state?.tracks[0]?.id).toBe('track-3');
      expect(state?.tracks[1]?.id).toBe('track-1');
      expect(state?.tracks[2]?.id).toBe('track-2');
    });
  });

  describe('Region Management', () => {
    let roomId: string;
    let trackId: string;

    beforeEach(() => {
      const roomData = roomService.createRoom(
        'Region Test Room',
        'owner',
        'owner-region',
        false,
        false,
        undefined,
        'arrange'
      );
      roomId = roomData.room.id;
      arrangeRoomStateService.initializeState(roomId);

      trackId = 'track-1';
      arrangeRoomStateService.addTrack(roomId, createTestTrack({ id: trackId }));
    });

    it('should add MIDI regions', () => {
      const region = createTestMidiRegion({ id: 'region-1', trackId });

      arrangeRoomStateService.addRegion(roomId, region);
      const state = arrangeRoomStateService.getState(roomId);

      expect(state?.regions).toHaveLength(1);
      expect(state?.regions[0]?.type).toBe('midi');
    });

    it('should add audio regions', () => {
      const region = createTestAudioRegion({ id: 'region-2', trackId, start: 4, length: 8 });

      arrangeRoomStateService.addRegion(roomId, region);
      const state = arrangeRoomStateService.getState(roomId);

      expect(state?.regions).toHaveLength(1);
      expect(state?.regions[0]?.type).toBe('audio');
      if (state?.regions[0]?.type === 'audio') {
        expect(state.regions[0].audioUrl).toBe('/audio/sample.wav');
      }
    });

    it('should update regions', () => {
      const region = createTestMidiRegion({ id: 'region-1', trackId });

      arrangeRoomStateService.addRegion(roomId, region);
      arrangeRoomStateService.updateRegion(roomId, 'region-1', {
        start: 2,
        length: 6,
      });

      const state = arrangeRoomStateService.getState(roomId);
      const updatedRegion = state?.regions.find(r => r.id === 'region-1');

      expect(updatedRegion?.start).toBe(2);
      expect(updatedRegion?.length).toBe(6);
    });

    it('should remove regions', () => {
      const region1 = createTestMidiRegion({ id: 'region-1', trackId });
      const region2 = createTestMidiRegion({ id: 'region-2', trackId, start: 4 });

      arrangeRoomStateService.addRegion(roomId, region1);
      arrangeRoomStateService.addRegion(roomId, region2);
      arrangeRoomStateService.removeRegion(roomId, 'region-1');

      const state = arrangeRoomStateService.getState(roomId);
      expect(state?.regions).toHaveLength(1);
      expect(state?.regions[0]?.id).toBe('region-2');
    });
  });

  describe('Collaboration Features', () => {
    let roomId: string;

    beforeEach(() => {
      const roomData = roomService.createRoom(
        'Collab Test Room',
        'owner',
        'owner-collab',
        false,
        false,
        undefined,
        'arrange'
      );
      roomId = roomData.room.id;
      arrangeRoomStateService.initializeState(roomId);
    });

    it('should acquire locks on elements', () => {
      const lockInfo = {
        userId: 'user-1',
        username: 'User1',
        type: 'region' as const,
        timestamp: Date.now(),
      };

      const acquired = arrangeRoomStateService.acquireLock(roomId, 'region-1', lockInfo);
      expect(acquired).toBe(true);

      const lock = arrangeRoomStateService.isLocked(roomId, 'region-1');
      expect(lock).toBeDefined();
      expect(lock?.userId).toBe('user-1');
    });

    it('should prevent duplicate locks', () => {
      const lockInfo1 = {
        userId: 'user-1',
        username: 'User1',
        type: 'region' as const,
        timestamp: Date.now(),
      };

      const lockInfo2 = {
        userId: 'user-2',
        username: 'User2',
        type: 'region' as const,
        timestamp: Date.now(),
      };

      arrangeRoomStateService.acquireLock(roomId, 'region-1', lockInfo1);
      const acquired = arrangeRoomStateService.acquireLock(roomId, 'region-1', lockInfo2);

      expect(acquired).toBe(false);
    });

    it('should release locks', () => {
      const lockInfo = {
        userId: 'user-1',
        username: 'User1',
        type: 'region' as const,
        timestamp: Date.now(),
      };

      arrangeRoomStateService.acquireLock(roomId, 'region-1', lockInfo);
      const released = arrangeRoomStateService.releaseLock(roomId, 'region-1', 'user-1');

      expect(released).toBe(true);
      const lock = arrangeRoomStateService.isLocked(roomId, 'region-1');
      expect(lock).toBeFalsy(); // Can be null or undefined
    });

    it('should release all user locks on disconnect', () => {
      const lockInfo = {
        userId: 'user-1',
        username: 'User1',
        type: 'region' as const,
        timestamp: Date.now(),
      };

      arrangeRoomStateService.acquireLock(roomId, 'region-1', lockInfo);
      arrangeRoomStateService.acquireLock(roomId, 'region-2', lockInfo);
      arrangeRoomStateService.acquireLock(roomId, 'track-1', { ...lockInfo, type: 'track' });

      const releasedIds = arrangeRoomStateService.releaseUserLocks(roomId, 'user-1');

      expect(releasedIds).toHaveLength(3);
      expect(arrangeRoomStateService.isLocked(roomId, 'region-1')).toBeFalsy();
      expect(arrangeRoomStateService.isLocked(roomId, 'region-2')).toBeFalsy();
      expect(arrangeRoomStateService.isLocked(roomId, 'track-1')).toBeFalsy();
    });
  });

  describe('Transport and Timing', () => {
    let roomId: string;

    beforeEach(() => {
      const roomData = roomService.createRoom(
        'Transport Test Room',
        'owner',
        'owner-transport',
        false,
        false,
        undefined,
        'arrange'
      );
      roomId = roomData.room.id;
      arrangeRoomStateService.initializeState(roomId);
    });

    it('should update BPM', () => {
      arrangeRoomStateService.setBpm(roomId, 140);
      const state = arrangeRoomStateService.getState(roomId);

      expect(state?.bpm).toBe(140);
    });

    it('should update time signature', () => {
      const timeSignature = { numerator: 3, denominator: 4 };
      arrangeRoomStateService.setTimeSignature(roomId, timeSignature);
      const state = arrangeRoomStateService.getState(roomId);

      expect(state?.timeSignature).toEqual(timeSignature);
    });
  });

  describe('Performance Tests', () => {
    it('should handle arrange room creation under load', async () => {
      const roomCount = 10;
      const measurements: number[] = [];

      for (let i = 0; i < roomCount; i++) {
        const startTime = performance.now();
        const roomData = roomService.createRoom(
          `Arrange Room ${i}`,
          `owner${i}`,
          `owner${i}`,
          false,
          false,
          undefined,
          'arrange'
        );
        arrangeRoomStateService.initializeState(roomData.room.id);
        const endTime = performance.now();
        
        measurements.push(endTime - startTime);
        expect(roomData).toBeDefined();
      }

      const averageTime = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      expect(averageTime).toBeLessThan(20); // 20ms average
    });

    it('should handle large number of tracks efficiently', async () => {
      const roomData = roomService.createRoom(
        'Large Track Room',
        'owner',
        'owner-large',
        false,
        false,
        undefined,
        'arrange'
      );
      arrangeRoomStateService.initializeState(roomData.room.id);

      const trackCount = 50;
      const startTime = performance.now();

      for (let i = 0; i < trackCount; i++) {
        arrangeRoomStateService.addTrack(roomData.room.id, createTestTrack({
          id: `track-${i}`,
          name: `Track ${i}`,
        }));
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      const state = arrangeRoomStateService.getState(roomData.room.id);
      expect(state?.tracks).toHaveLength(trackCount);
      expect(duration).toBeLessThan(100); // Should add 50 tracks in under 100ms
    });

    it('should handle large number of regions efficiently', async () => {
      const roomData = roomService.createRoom(
        'Large Region Room',
        'owner',
        'owner-regions',
        false,
        false,
        undefined,
        'arrange'
      );
      arrangeRoomStateService.initializeState(roomData.room.id);

      // Add a track first
      arrangeRoomStateService.addTrack(roomData.room.id, createTestTrack({ id: 'track-1' }));

      const regionCount = 100;
      const startTime = performance.now();

      for (let i = 0; i < regionCount; i++) {
        arrangeRoomStateService.addRegion(roomData.room.id, createTestMidiRegion({
          id: `region-${i}`,
          trackId: 'track-1',
          start: i * 4,
        }));
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      const state = arrangeRoomStateService.getState(roomData.room.id);
      expect(state?.regions).toHaveLength(regionCount);
      expect(duration).toBeLessThan(150); // Should add 100 regions in under 150ms
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid room operations gracefully', () => {
      expect(arrangeRoomStateService.getState('non-existent-room')).toBeUndefined();
    });

    it('should handle invalid track operations', () => {
      const roomData = roomService.createRoom(
        'Error Test Room',
        'owner',
        'owner-error',
        false,
        false,
        undefined,
        'arrange'
      );
      arrangeRoomStateService.initializeState(roomData.room.id);

      // Try to update non-existent track
      expect(() => {
        arrangeRoomStateService.updateTrack(roomData.room.id, 'non-existent-track', { volume: 0.5 });
      }).not.toThrow();
    });

    it('should handle invalid region operations', () => {
      const roomData = roomService.createRoom(
        'Error Test Room 2',
        'owner',
        'owner-error2',
        false,
        false,
        undefined,
        'arrange'
      );
      arrangeRoomStateService.initializeState(roomData.room.id);

      // Try to update non-existent region - should throw error
      expect(() => {
        arrangeRoomStateService.updateRegion(roomData.room.id, 'non-existent-region', { start: 4 });
      }).toThrow();
    });
  });
});
