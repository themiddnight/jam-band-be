import { ApprovalSessionManager } from '../../src/services/ApprovalSessionManager';
import { ApprovalSession } from '../../src/types';

describe('ApprovalSessionManager', () => {
  let approvalSessionManager: ApprovalSessionManager;
  const mockSocketId = 'socket-123';
  const mockRoomId = 'room-456';
  const mockUserId = 'user-789';
  const mockUsername = 'testuser';
  const mockRole = 'band_member' as const;

  beforeEach(() => {
    approvalSessionManager = new ApprovalSessionManager();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createApprovalSession', () => {
    it('should create a new approval session', () => {
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      expect(session).toEqual({
        roomId: mockRoomId,
        userId: mockUserId,
        username: mockUsername,
        role: mockRole,
        requestedAt: expect.any(Date),
        timeoutId: expect.any(Object)
      });
    });

    it('should remove existing session for user before creating new one', () => {
      const firstSocketId = 'socket-1';
      const secondSocketId = 'socket-2';

      // Create first session
      approvalSessionManager.createApprovalSession(
        firstSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      // Create second session for same user
      const secondSession = approvalSessionManager.createApprovalSession(
        secondSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      // First session should be removed
      expect(approvalSessionManager.getApprovalSession(firstSocketId)).toBeUndefined();
      expect(approvalSessionManager.getApprovalSession(secondSocketId)).toBeDefined();
    });

    it('should set up timeout for automatic cancellation', () => {
      const timeoutCallback = jest.fn();
      
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole,
        timeoutCallback
      );

      expect(session.timeoutId).toBeDefined();

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(30000);

      expect(timeoutCallback).toHaveBeenCalledWith(mockSocketId, expect.objectContaining({
        roomId: mockRoomId,
        userId: mockUserId,
        username: mockUsername,
        role: mockRole
      }));
    });
  });

  describe('getApprovalSession', () => {
    it('should return approval session by socket ID', () => {
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      const retrievedSession = approvalSessionManager.getApprovalSession(mockSocketId);
      expect(retrievedSession).toEqual(session);
    });

    it('should return undefined for non-existent socket ID', () => {
      const session = approvalSessionManager.getApprovalSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('getApprovalSessionByUserId', () => {
    it('should return approval session by user ID', () => {
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      const retrievedSession = approvalSessionManager.getApprovalSessionByUserId(mockUserId);
      expect(retrievedSession).toEqual(session);
    });

    it('should return undefined for non-existent user ID', () => {
      const session = approvalSessionManager.getApprovalSessionByUserId('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('removeApprovalSession', () => {
    it('should remove approval session by socket ID', () => {
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      const removedSession = approvalSessionManager.removeApprovalSession(mockSocketId);
      expect(removedSession).toEqual(session);
      expect(approvalSessionManager.getApprovalSession(mockSocketId)).toBeUndefined();
      expect(approvalSessionManager.getApprovalSessionByUserId(mockUserId)).toBeUndefined();
    });

    it('should clear timeout when removing session', () => {
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      approvalSessionManager.removeApprovalSession(mockSocketId);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(session.timeoutId);
    });

    it('should return undefined for non-existent socket ID', () => {
      const removedSession = approvalSessionManager.removeApprovalSession('non-existent');
      expect(removedSession).toBeUndefined();
    });
  });

  describe('removeApprovalSessionByUserId', () => {
    it('should remove approval session by user ID', () => {
      const session = approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      const removedSession = approvalSessionManager.removeApprovalSessionByUserId(mockUserId);
      expect(removedSession).toEqual(session);
      expect(approvalSessionManager.getApprovalSession(mockSocketId)).toBeUndefined();
      expect(approvalSessionManager.getApprovalSessionByUserId(mockUserId)).toBeUndefined();
    });

    it('should return undefined for non-existent user ID', () => {
      const removedSession = approvalSessionManager.removeApprovalSessionByUserId('non-existent');
      expect(removedSession).toBeUndefined();
    });
  });

  describe('hasApprovalSession', () => {
    it('should return true if user has approval session', () => {
      approvalSessionManager.createApprovalSession(
        mockSocketId,
        mockRoomId,
        mockUserId,
        mockUsername,
        mockRole
      );

      expect(approvalSessionManager.hasApprovalSession(mockUserId)).toBe(true);
    });

    it('should return false if user does not have approval session', () => {
      expect(approvalSessionManager.hasApprovalSession('non-existent')).toBe(false);
    });
  });

  describe('getApprovalSessionsForRoom', () => {
    it('should return all approval sessions for a room', () => {
      const user1Id = 'user-1';
      const user2Id = 'user-2';
      const socket1Id = 'socket-1';
      const socket2Id = 'socket-2';

      const session1 = approvalSessionManager.createApprovalSession(
        socket1Id,
        mockRoomId,
        user1Id,
        'user1',
        mockRole
      );

      const session2 = approvalSessionManager.createApprovalSession(
        socket2Id,
        mockRoomId,
        user2Id,
        'user2',
        mockRole
      );

      // Create session for different room
      approvalSessionManager.createApprovalSession(
        'socket-3',
        'different-room',
        'user-3',
        'user3',
        mockRole
      );

      const roomSessions = approvalSessionManager.getApprovalSessionsForRoom(mockRoomId);
      expect(roomSessions).toHaveLength(2);
      expect(roomSessions).toContainEqual(session1);
      expect(roomSessions).toContainEqual(session2);
    });

    it('should return empty array for room with no approval sessions', () => {
      const roomSessions = approvalSessionManager.getApprovalSessionsForRoom('non-existent-room');
      expect(roomSessions).toEqual([]);
    });
  });

  describe('getApprovalTimeoutMs', () => {
    it('should return the approval timeout duration', () => {
      const timeoutMs = approvalSessionManager.getApprovalTimeoutMs();
      expect(timeoutMs).toBe(30000); // 30 seconds
    });
  });

  describe('cleanup', () => {
    it('should clear all timeouts and sessions', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      // Create multiple sessions
      const session1 = approvalSessionManager.createApprovalSession(
        'socket-1',
        mockRoomId,
        'user-1',
        'user1',
        mockRole
      );

      const session2 = approvalSessionManager.createApprovalSession(
        'socket-2',
        mockRoomId,
        'user-2',
        'user2',
        mockRole
      );

      approvalSessionManager.cleanup();

      // All timeouts should be cleared
      expect(clearTimeoutSpy).toHaveBeenCalledWith(session1.timeoutId);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(session2.timeoutId);

      // All sessions should be removed
      expect(approvalSessionManager.getApprovalSession('socket-1')).toBeUndefined();
      expect(approvalSessionManager.getApprovalSession('socket-2')).toBeUndefined();
      expect(approvalSessionManager.getApprovalSessionByUserId('user-1')).toBeUndefined();
      expect(approvalSessionManager.getApprovalSessionByUserId('user-2')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return statistics about approval sessions', () => {
      const room1 = 'room-1';
      const room2 = 'room-2';

      // Create sessions for room1
      approvalSessionManager.createApprovalSession('socket-1', room1, 'user-1', 'user1', mockRole);
      approvalSessionManager.createApprovalSession('socket-2', room1, 'user-2', 'user2', mockRole);

      // Create session for room2
      approvalSessionManager.createApprovalSession('socket-3', room2, 'user-3', 'user3', mockRole);

      const stats = approvalSessionManager.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsByRoom).toEqual({
        [room1]: 2,
        [room2]: 1
      });
      expect(stats.oldestSessionAge).toBeGreaterThanOrEqual(0);
    });

    it('should return empty stats when no sessions exist', () => {
      const stats = approvalSessionManager.getStats();

      expect(stats.totalSessions).toBe(0);
      expect(stats.sessionsByRoom).toEqual({});
      expect(stats.oldestSessionAge).toBeNull();
    });
  });
});