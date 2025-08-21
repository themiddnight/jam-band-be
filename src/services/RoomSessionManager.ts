import { UserSession } from '../types';
import { loggingService } from './LoggingService';

export interface NamespaceSession extends UserSession {
  socketId: string;
  namespacePath: string;
  connectedAt: Date;
  lastActivity: Date;
}

export class RoomSessionManager {
  // Sessions organized by namespace type and room ID
  private roomSessions = new Map<string, Map<string, NamespaceSession>>(); // roomId -> socketId -> session
  private approvalSessions = new Map<string, Map<string, NamespaceSession>>(); // roomId -> socketId -> session
  private lobbySessions = new Map<string, NamespaceSession>(); // socketId -> session
  
  // Reverse lookup: socketId -> session for quick access
  private socketToSession = new Map<string, NamespaceSession>();

  constructor() {
    loggingService.logInfo('RoomSessionManager initialized');
  }

  /**
   * Set a room session for a user in a specific room namespace
   */
  setRoomSession(roomId: string, socketId: string, session: UserSession): void {
    if (!this.roomSessions.has(roomId)) {
      this.roomSessions.set(roomId, new Map());
    }

    const namespaceSession: NamespaceSession = {
      ...session,
      socketId,
      namespacePath: `/room/${roomId}`,
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.roomSessions.get(roomId)!.set(socketId, namespaceSession);
    this.socketToSession.set(socketId, namespaceSession);

    loggingService.logInfo('Set room session', {
      roomId,
      socketId,
      userId: session.userId,
      namespacePath: namespaceSession.namespacePath
    });
  }

  /**
   * Set an approval session for a user requesting to join a private room
   */
  setApprovalSession(roomId: string, socketId: string, session: UserSession): void {
    if (!this.approvalSessions.has(roomId)) {
      this.approvalSessions.set(roomId, new Map());
    }

    const namespaceSession: NamespaceSession = {
      ...session,
      socketId,
      namespacePath: `/approval/${roomId}`,
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.approvalSessions.get(roomId)!.set(socketId, namespaceSession);
    this.socketToSession.set(socketId, namespaceSession);

    loggingService.logInfo('Set approval session', {
      roomId,
      socketId,
      userId: session.userId,
      namespacePath: namespaceSession.namespacePath
    });
  }

  /**
   * Set a lobby session for latency monitoring
   */
  setLobbySession(socketId: string, userId: string): void {
    const namespaceSession: NamespaceSession = {
      roomId: 'lobby',
      userId,
      socketId,
      namespacePath: '/lobby-monitor',
      connectedAt: new Date(),
      lastActivity: new Date()
    };

    this.lobbySessions.set(socketId, namespaceSession);
    this.socketToSession.set(socketId, namespaceSession);

    loggingService.logInfo('Set lobby session', {
      socketId,
      userId,
      namespacePath: namespaceSession.namespacePath
    });
  }

  /**
   * Get room sessions for a specific room
   */
  getRoomSessions(roomId: string): Map<string, NamespaceSession> {
    return this.roomSessions.get(roomId) || new Map();
  }

  /**
   * Get approval sessions for a specific room
   */
  getApprovalSessions(roomId: string): Map<string, NamespaceSession> {
    return this.approvalSessions.get(roomId) || new Map();
  }

  /**
   * Get a session by socket ID (works across all namespace types)
   */
  getSession(socketId: string): NamespaceSession | undefined {
    const session = this.socketToSession.get(socketId);
    if (session) {
      // Update last activity
      session.lastActivity = new Date();
    }
    return session;
  }

  /**
   * Get room session by socket ID
   */
  getRoomSession(socketId: string): NamespaceSession | undefined {
    const session = this.getSession(socketId);
    return session?.namespacePath.startsWith('/room/') ? session : undefined;
  }

  /**
   * Get approval session by socket ID
   */
  getApprovalSession(socketId: string): NamespaceSession | undefined {
    const session = this.getSession(socketId);
    return session?.namespacePath.startsWith('/approval/') ? session : undefined;
  }

  /**
   * Get lobby session by socket ID
   */
  getLobbySession(socketId: string): NamespaceSession | undefined {
    const session = this.getSession(socketId);
    return session?.namespacePath === '/lobby-monitor' ? session : undefined;
  }

  /**
   * Remove a session by socket ID
   */
  removeSession(socketId: string): boolean {
    const session = this.socketToSession.get(socketId);
    if (!session) {
      return false;
    }

    // Remove from appropriate namespace map
    if (session.namespacePath.startsWith('/room/')) {
      const roomId = session.roomId;
      const roomSessions = this.roomSessions.get(roomId);
      if (roomSessions) {
        roomSessions.delete(socketId);
        if (roomSessions.size === 0) {
          this.roomSessions.delete(roomId);
        }
      }
    } else if (session.namespacePath.startsWith('/approval/')) {
      const roomId = session.roomId;
      const approvalSessions = this.approvalSessions.get(roomId);
      if (approvalSessions) {
        approvalSessions.delete(socketId);
        if (approvalSessions.size === 0) {
          this.approvalSessions.delete(roomId);
        }
      }
    } else if (session.namespacePath === '/lobby-monitor') {
      this.lobbySessions.delete(socketId);
    }

    // Remove from reverse lookup
    this.socketToSession.delete(socketId);

    loggingService.logInfo('Removed session', {
      socketId,
      userId: session.userId,
      roomId: session.roomId,
      namespacePath: session.namespacePath
    });

    return true;
  }

  /**
   * Remove all sessions for a specific room (both room and approval sessions)
   */
  cleanupRoomSessions(roomId: string): void {
    // Clean up room sessions
    const roomSessions = this.roomSessions.get(roomId);
    if (roomSessions) {
      for (const socketId of roomSessions.keys()) {
        this.socketToSession.delete(socketId);
      }
      this.roomSessions.delete(roomId);
    }

    // Clean up approval sessions
    const approvalSessions = this.approvalSessions.get(roomId);
    if (approvalSessions) {
      for (const socketId of approvalSessions.keys()) {
        this.socketToSession.delete(socketId);
      }
      this.approvalSessions.delete(roomId);
    }

    loggingService.logInfo('Cleaned up room sessions', {
      roomId,
      roomSessionsCount: roomSessions?.size || 0,
      approvalSessionsCount: approvalSessions?.size || 0
    });
  }

  /**
   * Find socket ID by user ID in a specific room
   */
  findSocketByUserId(roomId: string, userId: string): string | undefined {
    const roomSessions = this.roomSessions.get(roomId);
    if (roomSessions) {
      for (const [socketId, session] of roomSessions.entries()) {
        if (session.userId === userId) {
          return socketId;
        }
      }
    }
    return undefined;
  }

  /**
   * Find socket ID by user ID in approval sessions for a specific room
   */
  findApprovalSocketByUserId(roomId: string, userId: string): string | undefined {
    const approvalSessions = this.approvalSessions.get(roomId);
    if (approvalSessions) {
      for (const [socketId, session] of approvalSessions.entries()) {
        if (session.userId === userId) {
          return socketId;
        }
      }
    }
    return undefined;
  }

  /**
   * Remove old sessions for a user (keeping only the current socket)
   */
  removeOldSessionsForUser(userId: string, currentSocketId: string): void {
    const sessionsToRemove: string[] = [];

    // Check all sessions for this user
    for (const [socketId, session] of this.socketToSession.entries()) {
      if (session.userId === userId && socketId !== currentSocketId) {
        sessionsToRemove.push(socketId);
      }
    }

    // Remove old sessions
    sessionsToRemove.forEach(socketId => {
      this.removeSession(socketId);
    });

    if (sessionsToRemove.length > 0) {
      loggingService.logInfo('Removed old sessions for user', {
        userId,
        currentSocketId,
        removedSessions: sessionsToRemove.length
      });
    }
  }

  /**
   * Get all users in a room (from room sessions)
   */
  getRoomUsers(roomId: string): Array<{ userId: string; socketId: string }> {
    const roomSessions = this.roomSessions.get(roomId);
    if (!roomSessions) {
      return [];
    }

    return Array.from(roomSessions.values()).map(session => ({
      userId: session.userId,
      socketId: session.socketId
    }));
  }

  /**
   * Get all users waiting for approval in a room
   */
  getApprovalUsers(roomId: string): Array<{ userId: string; socketId: string }> {
    const approvalSessions = this.approvalSessions.get(roomId);
    if (!approvalSessions) {
      return [];
    }

    return Array.from(approvalSessions.values()).map(session => ({
      userId: session.userId,
      socketId: session.socketId
    }));
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    roomSessions: number;
    approvalSessions: number;
    lobbySessions: number;
    roomBreakdown: Array<{ roomId: string; roomSessions: number; approvalSessions: number }>;
  } {
    const roomBreakdown = new Map<string, { roomSessions: number; approvalSessions: number }>();

    // Count room sessions
    for (const [roomId, sessions] of this.roomSessions.entries()) {
      if (!roomBreakdown.has(roomId)) {
        roomBreakdown.set(roomId, { roomSessions: 0, approvalSessions: 0 });
      }
      roomBreakdown.get(roomId)!.roomSessions = sessions.size;
    }

    // Count approval sessions
    for (const [roomId, sessions] of this.approvalSessions.entries()) {
      if (!roomBreakdown.has(roomId)) {
        roomBreakdown.set(roomId, { roomSessions: 0, approvalSessions: 0 });
      }
      roomBreakdown.get(roomId)!.approvalSessions = sessions.size;
    }

    const totalRoomSessions = Array.from(this.roomSessions.values())
      .reduce((sum, sessions) => sum + sessions.size, 0);
    const totalApprovalSessions = Array.from(this.approvalSessions.values())
      .reduce((sum, sessions) => sum + sessions.size, 0);

    return {
      totalSessions: this.socketToSession.size,
      roomSessions: totalRoomSessions,
      approvalSessions: totalApprovalSessions,
      lobbySessions: this.lobbySessions.size,
      roomBreakdown: Array.from(roomBreakdown.entries()).map(([roomId, counts]) => ({
        roomId,
        ...counts
      }))
    };
  }

  /**
   * Clean up expired sessions (sessions that haven't been active for a long time)
   */
  cleanupExpiredSessions(maxInactiveMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    const expiredSockets: string[] = [];

    for (const [socketId, session] of this.socketToSession.entries()) {
      const inactiveTime = now - session.lastActivity.getTime();
      if (inactiveTime > maxInactiveMs) {
        expiredSockets.push(socketId);
      }
    }

    expiredSockets.forEach(socketId => {
      this.removeSession(socketId);
    });

    if (expiredSockets.length > 0) {
      loggingService.logInfo('Cleaned up expired sessions', {
        expiredCount: expiredSockets.length,
        maxInactiveMs
      });
    }
  }
}