/**
 * Unit Tests for RoomService
 * Tests individual methods in isolation with mocked dependencies
 */
import { RoomService } from '../../../src/services/RoomService';
import { RoomSessionManager } from '../../../src/services/RoomSessionManager';

describe('RoomService - Unit Tests', () => {
  let roomService: RoomService;
  let mockRoomSessionManager: jest.Mocked<RoomSessionManager>;

  beforeEach(() => {
    // Create mock RoomSessionManager
    mockRoomSessionManager = {
      setRoomSession: jest.fn(),
      getSession: jest.fn(),
      removeSession: jest.fn(),
      getRoomSessions: jest.fn(),
      setApprovalSession: jest.fn(),
      setLobbySession: jest.fn(),
      getApprovalSessions: jest.fn(),
      getRoomSession: jest.fn(),
      getApprovalSession: jest.fn(),
      getLobbySession: jest.fn(),
      cleanupRoomSessions: jest.fn(),
      getSessionStats: jest.fn()
    } as any;
    
    // Initialize service with mocks
    roomService = new RoomService(mockRoomSessionManager);
  });

  describe('createRoom', () => {
    it('should create a room with valid data', () => {
      // Arrange
      const name = 'Test Room';
      const username = 'testuser';
      const userId = 'user123';
      const isPrivate = false;
      const isHidden = false;
      const description = 'Test room description';
      const roomType = 'perform' as const;

      // Act
      const result = roomService.createRoom(
        name,
        username,
        userId,
        isPrivate,
        isHidden,
        description,
        roomType
      );

      // Assert
      expect(result).toHaveProperty('room');
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('session');
      
      expect(result.room.name).toBe(name);
      expect(result.room.owner).toBe(userId);
      expect(result.room.isPrivate).toBe(isPrivate);
      expect(result.room.isHidden).toBe(isHidden);
      expect(result.room.description).toBe(description);
      expect(result.room.roomType).toBe(roomType);
      
      expect(result.user.id).toBe(userId);
      expect(result.user.username).toBe(username);
      expect(result.user.role).toBe('room_owner');
      expect(result.user.isReady).toBe(true);
      
      // Validate room structure
      expect(result.room).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        owner: expect.any(String),
        isPrivate: expect.any(Boolean),
        createdAt: expect.any(Date)
      });

      // Validate user structure
      expect(result.user).toMatchObject({
        id: expect.any(String),
        username: expect.any(String),
        role: expect.stringMatching(/^(room_owner|performer|audience|admin)$/),
        isReady: expect.any(Boolean)
      });
    });

    it('should create room with default parameters', () => {
      // Arrange
      const name = 'Simple Room';
      const username = 'user';
      const userId = 'user456';

      // Act
      const result = roomService.createRoom(name, username, userId);

      // Assert
      expect(result.room.isPrivate).toBe(false);
      expect(result.room.isHidden).toBe(false);
      expect(result.room.roomType).toBe('perform');
      expect(result.room.description).toBeUndefined();
    });

    it('should ensure user has effect chains', () => {
      // Arrange
      const name = 'Effect Room';
      const username = 'effectuser';
      const userId = 'user789';

      // Act
      const result = roomService.createRoom(name, username, userId);

      // Assert
      expect(result.user.effectChains).toBeDefined();
      expect(result.user.effectChains).toHaveProperty('virtual_instrument');
      expect(result.user.effectChains).toHaveProperty('audio_voice_input');
    });
  });

  describe('getDefaultEffectChains', () => {
    it('should return default effect chains structure', () => {
      // Act
      const result = roomService.getDefaultEffectChains();

      // Assert
      expect(result).toHaveProperty('virtual_instrument');
      expect(result).toHaveProperty('audio_voice_input');
      expect(result.virtual_instrument.type).toBe('virtual_instrument');
      expect(result.virtual_instrument.effects).toEqual([]);
      expect(result.audio_voice_input.type).toBe('audio_voice_input');
      expect(result.audio_voice_input.effects).toEqual([]);
    });
  });

  describe('ensureUserEffectChains', () => {
    it('should add missing effect chains to user', () => {
      // Arrange
      const user = {
        id: 'test-user',
        username: 'testuser',
        role: 'audience' as const,
        isReady: true
      } as any; // Use any to bypass strict typing for test

      // Act
      roomService.ensureUserEffectChains(user);

      // Assert
      expect(user.effectChains).toBeDefined();
      expect(user.effectChains).toHaveProperty('virtual_instrument');
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });

    it('should not overwrite existing effect chains', () => {
      // Arrange
      const existingEffects = [{ id: 'test-effect', type: 'reverb' }];
      const user = {
        id: 'test-user',
        username: 'testuser',
        role: 'audience' as const,
        isReady: true,
        effectChains: {
          virtual_instrument: {
            type: 'virtual_instrument' as const,
            effects: existingEffects
          }
        }
      } as any; // Use any to bypass strict typing for test

      // Act
      roomService.ensureUserEffectChains(user);

      // Assert
      expect(user.effectChains?.virtual_instrument.effects).toEqual(existingEffects);
      expect(user.effectChains).toHaveProperty('audio_voice_input');
    });
  });

  describe('performance tests', () => {
    it('should create room within acceptable time', async () => {
      // Arrange
      const name = 'Performance Room';
      const username = 'perfuser';
      const userId = 'perf123';

      // Act & Assert
      const start = performance.now();
      const result = roomService.createRoom(name, username, userId);
      const end = performance.now();
      const duration = end - start;

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });
  });
});