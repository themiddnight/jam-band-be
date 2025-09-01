import { RoomListing, RoomCapacityStatus, RoomActivityStatus } from '../RoomListing';
import { RoomId, UserId } from '../../../../../shared/domain/models/ValueObjects';

describe('RoomListing', () => {
  interface RoomListingParams {
    id?: RoomId;
    name?: string;
    memberCount?: number;
    maxMembers?: number;
    isPrivate?: boolean;
    requiresApproval?: boolean;
    genres?: string[];
    description?: string;
    owner?: UserId;
    ownerUsername?: string;
    createdAt?: Date;
    lastActivity?: Date;
    isActive?: boolean;
  }

  const createTestRoomListing = (overrides: RoomListingParams = {}): RoomListing => {
    const defaults = {
      id: RoomId.generate(),
      name: 'Test Room',
      memberCount: 2,
      maxMembers: 8,
      isPrivate: false,
      requiresApproval: false,
      genres: ['rock', 'jazz'],
      description: 'A test room',
      owner: UserId.generate(),
      ownerUsername: 'testowner',
      createdAt: new Date(),
      lastActivity: new Date(),
      isActive: true
    };

    return new RoomListing(
      overrides.id || defaults.id,
      overrides.name !== undefined ? overrides.name : defaults.name,
      overrides.memberCount !== undefined ? overrides.memberCount : defaults.memberCount,
      overrides.maxMembers !== undefined ? overrides.maxMembers : defaults.maxMembers,
      overrides.isPrivate !== undefined ? overrides.isPrivate : defaults.isPrivate,
      overrides.requiresApproval !== undefined ? overrides.requiresApproval : defaults.requiresApproval,
      overrides.genres || defaults.genres,
      overrides.description !== undefined ? overrides.description : defaults.description,
      overrides.owner || defaults.owner,
      overrides.ownerUsername || defaults.ownerUsername,
      overrides.createdAt || defaults.createdAt,
      overrides.lastActivity || defaults.lastActivity,
      overrides.isActive !== undefined ? overrides.isActive : defaults.isActive
    );
  };

  describe('validation', () => {
    it('should create a valid room listing', () => {
      expect(() => createTestRoomListing()).not.toThrow();
    });

    it('should throw error for empty name', () => {
      expect(() => createTestRoomListing({ name: '' })).toThrow('Room name cannot be empty');
    });

    it('should throw error for negative member count', () => {
      expect(() => createTestRoomListing({ memberCount: -1 })).toThrow('Member count cannot be negative');
    });

    it('should throw error for invalid max members', () => {
      expect(() => createTestRoomListing({ maxMembers: 0 })).toThrow('Max members must be at least 1');
    });

    it('should throw error when member count exceeds max members', () => {
      expect(() => createTestRoomListing({ memberCount: 10, maxMembers: 5 }))
        .toThrow('Member count cannot exceed max members');
    });
  });

  describe('canJoin', () => {
    it('should allow joining public room with space', () => {
      const room = createTestRoomListing({ isPrivate: false, memberCount: 2, maxMembers: 8 });
      const userId = UserId.generate();

      expect(room.canJoin(userId)).toBe(true);
    });

    it('should not allow joining full room', () => {
      const room = createTestRoomListing({ memberCount: 8, maxMembers: 8 });
      const userId = UserId.generate();

      expect(room.canJoin(userId)).toBe(false);
    });

    it('should not allow joining inactive room', () => {
      const room = createTestRoomListing({ isActive: false });
      const userId = UserId.generate();

      expect(room.canJoin(userId)).toBe(false);
    });

    it('should allow owner to join private room', () => {
      const ownerId = UserId.generate();
      const room = createTestRoomListing({ isPrivate: true, owner: ownerId });

      expect(room.canJoin(ownerId)).toBe(true);
    });

    it('should allow joining private room with approval enabled', () => {
      const room = createTestRoomListing({ isPrivate: true, requiresApproval: true });
      const userId = UserId.generate();

      expect(room.canJoin(userId)).toBe(true);
    });

    it('should not allow joining private room without approval', () => {
      const room = createTestRoomListing({ isPrivate: true, requiresApproval: false });
      const userId = UserId.generate();

      expect(room.canJoin(userId)).toBe(false);
    });
  });

  describe('capacity status', () => {
    it('should return EMPTY for room with no members', () => {
      const room = createTestRoomListing({ memberCount: 0 });
      expect(room.getCapacityStatus()).toBe(RoomCapacityStatus.EMPTY);
    });

    it('should return AVAILABLE for room with some members', () => {
      const room = createTestRoomListing({ memberCount: 3, maxMembers: 8 });
      expect(room.getCapacityStatus()).toBe(RoomCapacityStatus.AVAILABLE);
    });

    it('should return NEARLY_FULL for room at 80% capacity', () => {
      const room = createTestRoomListing({ memberCount: 7, maxMembers: 8 });
      expect(room.getCapacityStatus()).toBe(RoomCapacityStatus.NEARLY_FULL);
    });

    it('should return FULL for room at max capacity', () => {
      const room = createTestRoomListing({ memberCount: 8, maxMembers: 8 });
      expect(room.getCapacityStatus()).toBe(RoomCapacityStatus.FULL);
    });
  });

  describe('activity status', () => {
    it('should return INACTIVE for inactive room', () => {
      const room = createTestRoomListing({ isActive: false });
      expect(room.getActivityStatus()).toBe(RoomActivityStatus.INACTIVE);
    });

    it('should return ACTIVE for recently active room', () => {
      const recentTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      const room = createTestRoomListing({ lastActivity: recentTime });
      expect(room.getActivityStatus()).toBe(RoomActivityStatus.ACTIVE);
    });

    it('should return IDLE for room not recently active', () => {
      const oldTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const room = createTestRoomListing({ lastActivity: oldTime });
      expect(room.getActivityStatus()).toBe(RoomActivityStatus.IDLE);
    });
  });

  describe('genre matching', () => {
    it('should match genre case-insensitively', () => {
      const room = createTestRoomListing({ genres: ['Rock', 'Jazz'] });
      expect(room.hasGenre('rock')).toBe(true);
      expect(room.hasGenre('JAZZ')).toBe(true);
    });

    it('should match any genre from list', () => {
      const room = createTestRoomListing({ genres: ['rock', 'jazz'] });
      expect(room.hasAnyGenre(['pop', 'rock'])).toBe(true);
      expect(room.hasAnyGenre(['pop', 'classical'])).toBe(false);
    });
  });

  describe('search term matching', () => {
    it('should match room name', () => {
      const room = createTestRoomListing({ name: 'Rock Jam Session' });
      expect(room.matchesSearchTerm('rock')).toBe(true);
      expect(room.matchesSearchTerm('jam')).toBe(true);
      expect(room.matchesSearchTerm('pop')).toBe(false);
    });

    it('should match owner username', () => {
      const room = createTestRoomListing({ ownerUsername: 'rockstar123' });
      expect(room.matchesSearchTerm('rockstar')).toBe(true);
      expect(room.matchesSearchTerm('123')).toBe(true);
    });

    it('should match description', () => {
      const room = createTestRoomListing({ description: 'Blues and rock music session' });
      expect(room.matchesSearchTerm('blues')).toBe(true);
      expect(room.matchesSearchTerm('session')).toBe(true);
    });

    it('should match genres', () => {
      const room = createTestRoomListing({ genres: ['progressive rock', 'jazz fusion'] });
      expect(room.matchesSearchTerm('progressive')).toBe(true);
      expect(room.matchesSearchTerm('fusion')).toBe(true);
    });

    it('should return true for empty search term', () => {
      const room = createTestRoomListing();
      expect(room.matchesSearchTerm('')).toBe(true);
      expect(room.matchesSearchTerm('   ')).toBe(true);
    });
  });

  describe('toSummary', () => {
    it('should create correct summary', () => {
      const room = createTestRoomListing({
        name: 'Test Room',
        memberCount: 3,
        maxMembers: 8,
        isPrivate: false,
        genres: ['rock', 'jazz'],
        ownerUsername: 'testowner'
      });

      const summary = room.toSummary();

      expect(summary.name).toBe('Test Room');
      expect(summary.memberCount).toBe(3);
      expect(summary.maxMembers).toBe(8);
      expect(summary.isPrivate).toBe(false);
      expect(summary.genres).toEqual(['rock', 'jazz']);
      expect(summary.ownerUsername).toBe('testowner');
      expect(summary.capacityStatus).toBe(RoomCapacityStatus.AVAILABLE);
      expect(summary.canJoinDirectly).toBe(true);
    });
  });
});