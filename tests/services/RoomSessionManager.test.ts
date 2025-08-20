import { RoomSessionManager } from '../../src/services/RoomSessionManager';
import { UserSession } from '../../src/types';

// Mock the LoggingService
jest.mock('../../src/services/LoggingService', () => ({
    loggingService: {
        logInfo: jest.fn(),
        logError: jest.fn(),
        logWarning: jest.fn(),
    },
}));

describe('RoomSessionManager', () => {
    let sessionManager: RoomSessionManager;

    beforeEach(() => {
        sessionManager = new RoomSessionManager();
    });

    describe('setRoomSession', () => {
        it('should set a room session', () => {
            const roomId = 'test-room-123';
            const socketId = 'socket-123';
            const session: UserSession = { roomId, userId: 'user-123' };

            sessionManager.setRoomSession(roomId, socketId, session);

            const retrievedSession = sessionManager.getRoomSession(socketId);
            expect(retrievedSession).toBeDefined();
            expect(retrievedSession?.userId).toBe('user-123');
            expect(retrievedSession?.roomId).toBe(roomId);
            expect(retrievedSession?.namespacePath).toBe(`/room/${roomId}`);
        });
    });

    describe('setApprovalSession', () => {
        it('should set an approval session', () => {
            const roomId = 'test-room-123';
            const socketId = 'socket-123';
            const session: UserSession = { roomId, userId: 'user-123' };

            sessionManager.setApprovalSession(roomId, socketId, session);

            const retrievedSession = sessionManager.getApprovalSession(socketId);
            expect(retrievedSession).toBeDefined();
            expect(retrievedSession?.userId).toBe('user-123');
            expect(retrievedSession?.roomId).toBe(roomId);
            expect(retrievedSession?.namespacePath).toBe(`/approval/${roomId}`);
        });
    });

    describe('setLobbySession', () => {
        it('should set a lobby session', () => {
            const socketId = 'socket-123';
            const userId = 'user-123';

            sessionManager.setLobbySession(socketId, userId);

            const retrievedSession = sessionManager.getLobbySession(socketId);
            expect(retrievedSession).toBeDefined();
            expect(retrievedSession?.userId).toBe(userId);
            expect(retrievedSession?.roomId).toBe('lobby');
            expect(retrievedSession?.namespacePath).toBe('/lobby-monitor');
        });
    });

    describe('removeSession', () => {
        it('should remove a room session', () => {
            const roomId = 'test-room-123';
            const socketId = 'socket-123';
            const session: UserSession = { roomId, userId: 'user-123' };

            sessionManager.setRoomSession(roomId, socketId, session);
            expect(sessionManager.getRoomSession(socketId)).toBeDefined();

            const removed = sessionManager.removeSession(socketId);
            expect(removed).toBe(true);
            expect(sessionManager.getRoomSession(socketId)).toBeUndefined();
        });

        it('should return false when removing non-existent session', () => {
            const removed = sessionManager.removeSession('non-existent-socket');
            expect(removed).toBe(false);
        });
    });

    describe('findSocketByUserId', () => {
        it('should find socket by user ID in room', () => {
            const roomId = 'test-room-123';
            const socketId = 'socket-123';
            const userId = 'user-123';
            const session: UserSession = { roomId, userId };

            sessionManager.setRoomSession(roomId, socketId, session);

            const foundSocketId = sessionManager.findSocketByUserId(roomId, userId);
            expect(foundSocketId).toBe(socketId);
        });

        it('should return undefined for non-existent user', () => {
            const foundSocketId = sessionManager.findSocketByUserId('room-123', 'non-existent-user');
            expect(foundSocketId).toBeUndefined();
        });
    });

    describe('cleanupRoomSessions', () => {
        it('should cleanup all sessions for a room', () => {
            const roomId = 'test-room-123';
            const socketId1 = 'socket-1';
            const socketId2 = 'socket-2';
            const session1: UserSession = { roomId, userId: 'user-1' };
            const session2: UserSession = { roomId, userId: 'user-2' };

            sessionManager.setRoomSession(roomId, socketId1, session1);
            sessionManager.setApprovalSession(roomId, socketId2, session2);

            expect(sessionManager.getRoomSession(socketId1)).toBeDefined();
            expect(sessionManager.getApprovalSession(socketId2)).toBeDefined();

            sessionManager.cleanupRoomSessions(roomId);

            expect(sessionManager.getRoomSession(socketId1)).toBeUndefined();
            expect(sessionManager.getApprovalSession(socketId2)).toBeUndefined();
        });
    });

    describe('getSessionStats', () => {
        it('should return correct session statistics', () => {
            const roomId = 'test-room-123';
            const session1: UserSession = { roomId, userId: 'user-1' };
            const session2: UserSession = { roomId, userId: 'user-2' };

            sessionManager.setRoomSession(roomId, 'socket-1', session1);
            sessionManager.setApprovalSession(roomId, 'socket-2', session2);
            sessionManager.setLobbySession('socket-3', 'user-3');

            const stats = sessionManager.getSessionStats();

            expect(stats.totalSessions).toBe(3);
            expect(stats.roomSessions).toBe(1);
            expect(stats.approvalSessions).toBe(1);
            expect(stats.lobbySessions).toBe(1);
            expect(stats.roomBreakdown).toHaveLength(1);
            expect(stats.roomBreakdown[0]?.roomId).toBe(roomId);
        });
    });
});