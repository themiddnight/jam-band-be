import { NamespaceGracePeriodManager } from '../NamespaceGracePeriodManager';

// Mock the logging service
jest.mock('../LoggingService', () => ({
  loggingService: {
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
  }
}));

describe('NamespaceGracePeriodManager', () => {
  let manager: NamespaceGracePeriodManager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new NamespaceGracePeriodManager();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllTimers();
  });

  describe('addToGracePeriod', () => {
    it('should add user to grace period for specific room', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);

      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(true);
      expect(manager.isUserInGracePeriod('user1', 'room2')).toBe(false);
    });

    it('should isolate grace periods between rooms', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      manager.addToGracePeriod('user2', 'room2', '/room/room2', userData2, false);

      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(true);
      expect(manager.isUserInGracePeriod('user2', 'room2')).toBe(true);
      expect(manager.isUserInGracePeriod('user1', 'room2')).toBe(false);
      expect(manager.isUserInGracePeriod('user2', 'room1')).toBe(false);
    });

    it('should handle intended leave flag', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, true);

      const entry = manager.getGracePeriodEntry('user1', 'room1');
      expect(entry?.isIntendedLeave).toBe(true);
    });
  });

  describe('isUserInGracePeriod', () => {
    it('should return true for user within grace period', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);

      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(true);
    });

    it('should return false for expired grace period', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);

      // Fast forward past grace period (30 seconds + 1ms)
      jest.advanceTimersByTime(30001);

      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(false);
    });

    it('should return false for non-existent user', () => {
      expect(manager.isUserInGracePeriod('nonexistent', 'room1')).toBe(false);
    });

    it('should return false for non-existent room', () => {
      expect(manager.isUserInGracePeriod('user1', 'nonexistent')).toBe(false);
    });
  });

  describe('getGracePeriodEntry', () => {
    it('should return grace period entry with user data', () => {
      const userData = { 
        id: 'user1', 
        username: 'TestUser', 
        role: 'band_member',
        currentInstrument: 'piano',
        currentCategory: 'Keyboard'
      };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);

      const entry = manager.getGracePeriodEntry('user1', 'room1');
      
      expect(entry).toBeTruthy();
      expect(entry?.userId).toBe('user1');
      expect(entry?.roomId).toBe('room1');
      expect(entry?.namespacePath).toBe('/room/room1');
      expect(entry?.userData).toEqual(userData);
      expect(entry?.isIntendedLeave).toBe(false);
    });

    it('should return null for expired entry', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);

      // Fast forward past grace period
      jest.advanceTimersByTime(30001);

      const entry = manager.getGracePeriodEntry('user1', 'room1');
      expect(entry).toBeNull();
    });
  });

  describe('removeFromGracePeriod', () => {
    it('should remove user from grace period', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);
      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(true);

      const removed = manager.removeFromGracePeriod('user1', 'room1');
      
      expect(removed).toBe(true);
      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(false);
    });

    it('should return false for non-existent user', () => {
      const removed = manager.removeFromGracePeriod('nonexistent', 'room1');
      expect(removed).toBe(false);
    });

    it('should clean up empty room maps', () => {
      const userData = { id: 'user1', username: 'TestUser', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData, false);
      manager.removeFromGracePeriod('user1', 'room1');

      const stats = manager.getGracePeriodStats();
      expect(stats.roomCount).toBe(0);
    });
  });

  describe('getRoomGracePeriodUsers', () => {
    it('should return all users in grace period for a room', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      manager.addToGracePeriod('user2', 'room1', '/room/room1', userData2, false);

      const users = manager.getRoomGracePeriodUsers('room1');
      
      expect(users).toHaveLength(2);
      expect(users.map(u => u.userId)).toContain('user1');
      expect(users.map(u => u.userId)).toContain('user2');
    });

    it('should filter out expired users', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      
      // Fast forward 15 seconds
      jest.advanceTimersByTime(15000);
      
      manager.addToGracePeriod('user2', 'room1', '/room/room1', userData2, false);
      
      // Fast forward another 20 seconds (user1 should be expired, user2 should not)
      jest.advanceTimersByTime(20000);

      const users = manager.getRoomGracePeriodUsers('room1');
      
      expect(users).toHaveLength(1);
      expect(users[0]?.userId).toBe('user2');
    });

    it('should return empty array for non-existent room', () => {
      const users = manager.getRoomGracePeriodUsers('nonexistent');
      expect(users).toEqual([]);
    });
  });

  describe('cleanupRoomGracePeriod', () => {
    it('should remove all grace period entries for a room', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      manager.addToGracePeriod('user2', 'room1', '/room/room1', userData2, false);

      manager.cleanupRoomGracePeriod('room1');

      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(false);
      expect(manager.isUserInGracePeriod('user2', 'room1')).toBe(false);
    });
  });

  describe('cleanupExpiredGracePeriods', () => {
    it('should remove expired entries across all rooms', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      const userData3 = { id: 'user3', username: 'User3', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      manager.addToGracePeriod('user2', 'room2', '/room/room2', userData2, false);
      
      // Fast forward 15 seconds
      jest.advanceTimersByTime(15000);
      
      manager.addToGracePeriod('user3', 'room1', '/room/room1', userData3, false);
      
      // Fast forward another 20 seconds (user1 and user2 should be expired)
      jest.advanceTimersByTime(20000);

      manager.cleanupExpiredGracePeriods();

      expect(manager.isUserInGracePeriod('user1', 'room1')).toBe(false);
      expect(manager.isUserInGracePeriod('user2', 'room2')).toBe(false);
      expect(manager.isUserInGracePeriod('user3', 'room1')).toBe(true);
    });
  });

  describe('getGracePeriodStats', () => {
    it('should return accurate statistics', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      const userData3 = { id: 'user3', username: 'User3', role: 'band_member' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      manager.addToGracePeriod('user2', 'room1', '/room/room1', userData2, false);
      manager.addToGracePeriod('user3', 'room2', '/room/room2', userData3, false);

      const stats = manager.getGracePeriodStats();

      expect(stats.totalUsers).toBe(3);
      expect(stats.roomCount).toBe(2);
      expect(stats.roomBreakdown).toHaveLength(2);
      
      const room1Stats = stats.roomBreakdown.find(r => r.roomId === 'room1');
      const room2Stats = stats.roomBreakdown.find(r => r.roomId === 'room2');
      
      expect(room1Stats?.userCount).toBe(2);
      expect(room2Stats?.userCount).toBe(1);
    });

    it('should exclude expired users from statistics', () => {
      const userData1 = { id: 'user1', username: 'User1', role: 'band_member' };
      const userData2 = { id: 'user2', username: 'User2', role: 'audience' };
      
      manager.addToGracePeriod('user1', 'room1', '/room/room1', userData1, false);
      
      // Fast forward 15 seconds
      jest.advanceTimersByTime(15000);
      
      manager.addToGracePeriod('user2', 'room1', '/room/room1', userData2, false);

      // Fast forward another 20 seconds (user1 should be expired, user2 should not)
      jest.advanceTimersByTime(20000);

      const stats = manager.getGracePeriodStats();

      expect(stats.totalUsers).toBe(1);
      expect(stats.roomBreakdown[0]?.userCount).toBe(1);
    });
  });

  describe('getGracePeriodMs', () => {
    it('should return the grace period duration', () => {
      expect(manager.getGracePeriodMs()).toBe(30000); // 30 seconds
    });
  });
});