import { loggingService } from './LoggingService';

/**
 * Namespace-aware grace period management for room isolation
 * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
 */

export interface GracePeriodEntry {
  userId: string;
  roomId: string;
  namespacePath: string;
  timestamp: number;
  isIntendedLeave: boolean;
  userData: any;
}

export class NamespaceGracePeriodManager {
  // Grace period entries organized by room for isolation
  private roomGracePeriods = new Map<string, Map<string, GracePeriodEntry>>(); // roomId -> userId -> entry
  private readonly GRACE_PERIOD_MS = 30000; // 30 seconds (reduced from 60s for better UX)
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    loggingService.logInfo('NamespaceGracePeriodManager initialized');
    
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Add user to grace period for a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  addToGracePeriod(
    userId: string, 
    roomId: string, 
    namespacePath: string, 
    userData: any, 
    isIntendedLeave: boolean = false
  ): void {
    if (!this.roomGracePeriods.has(roomId)) {
      this.roomGracePeriods.set(roomId, new Map());
    }

    const entry: GracePeriodEntry = {
      userId,
      roomId,
      namespacePath,
      timestamp: Date.now(),
      isIntendedLeave,
      userData
    };

    this.roomGracePeriods.get(roomId)!.set(userId, entry);

    loggingService.logInfo('Added user to grace period', {
      userId,
      roomId,
      namespacePath,
      isIntendedLeave,
      gracePeriodMs: this.GRACE_PERIOD_MS
    });
  }

  /**
   * Check if user is in grace period for a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  isUserInGracePeriod(userId: string, roomId: string): boolean {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return false;
    }

    const entry = roomGracePeriods.get(userId);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (now - entry.timestamp > this.GRACE_PERIOD_MS) {
      // Grace period expired, remove entry
      roomGracePeriods.delete(userId);
      if (roomGracePeriods.size === 0) {
        this.roomGracePeriods.delete(roomId);
      }
      return false;
    }

    return true;
  }

  /**
   * Get grace period entry for a user in a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  getGracePeriodEntry(userId: string, roomId: string): GracePeriodEntry | null {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return null;
    }

    const entry = roomGracePeriods.get(userId);
    if (!entry) {
      return null;
    }

    // Check if still valid
    const now = Date.now();
    if (now - entry.timestamp > this.GRACE_PERIOD_MS) {
      roomGracePeriods.delete(userId);
      if (roomGracePeriods.size === 0) {
        this.roomGracePeriods.delete(roomId);
      }
      return null;
    }

    return entry;
  }

  /**
   * Remove user from grace period
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  removeFromGracePeriod(userId: string, roomId: string): boolean {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return false;
    }

    const removed = roomGracePeriods.delete(userId);
    if (roomGracePeriods.size === 0) {
      this.roomGracePeriods.delete(roomId);
    }

    if (removed) {
      loggingService.logInfo('Removed user from grace period', {
        userId,
        roomId
      });
    }

    return removed;
  }

  /**
   * Get all users in grace period for a specific room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  getRoomGracePeriodUsers(roomId: string): GracePeriodEntry[] {
    const roomGracePeriods = this.roomGracePeriods.get(roomId);
    if (!roomGracePeriods) {
      return [];
    }

    const now = Date.now();
    const validEntries: GracePeriodEntry[] = [];
    const expiredUsers: string[] = [];

    for (const [userId, entry] of roomGracePeriods.entries()) {
      if (now - entry.timestamp > this.GRACE_PERIOD_MS) {
        expiredUsers.push(userId);
      } else {
        validEntries.push(entry);
      }
    }

    // Clean up expired entries
    expiredUsers.forEach(userId => {
      roomGracePeriods.delete(userId);
    });

    if (roomGracePeriods.size === 0) {
      this.roomGracePeriods.delete(roomId);
    }

    return validEntries;
  }

  /**
   * Clean up all grace period entries for a room
   * Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
   */
  cleanupRoomGracePeriod(roomId: string): void {
    const removed = this.roomGracePeriods.delete(roomId);
    if (removed) {
      loggingService.logInfo('Cleaned up room grace period', { roomId });
    }
  }

  /**
   * Clean up expired grace period entries across all rooms
   * Returns a list of rooms that may need cleanup after grace period expiration
   */
  cleanupExpiredGracePeriods(): string[] {
    const now = Date.now();
    let totalCleaned = 0;
    const roomsNeedingCleanup: string[] = [];

    for (const [roomId, roomGracePeriods] of this.roomGracePeriods.entries()) {
      const expiredUsers: string[] = [];

      for (const [userId, entry] of roomGracePeriods.entries()) {
        if (now - entry.timestamp > this.GRACE_PERIOD_MS) {
          expiredUsers.push(userId);
        }
      }

      if (expiredUsers.length > 0) {
        expiredUsers.forEach(userId => {
          roomGracePeriods.delete(userId);
          totalCleaned++;
        });

        // Mark room for potential cleanup since grace periods expired
        roomsNeedingCleanup.push(roomId);
      }

      if (roomGracePeriods.size === 0) {
        this.roomGracePeriods.delete(roomId);
      }
    }

    if (totalCleaned > 0) {
      loggingService.logInfo('Cleaned up expired grace period entries', {
        totalCleaned,
        activeRooms: this.roomGracePeriods.size,
        roomsNeedingCleanup: roomsNeedingCleanup.length
      });
    }

    return roomsNeedingCleanup;
  }

  /**
   * Get grace period duration in milliseconds
   */
  getGracePeriodMs(): number {
    return this.GRACE_PERIOD_MS;
  }

  /**
   * Get statistics about grace period usage
   */
  getGracePeriodStats(): {
    totalUsers: number;
    roomCount: number;
    roomBreakdown: Array<{ roomId: string; userCount: number; entries: Array<{ userId: string; timeRemaining: number }> }>;
  } {
    const now = Date.now();
    let totalUsers = 0;
    const roomBreakdown: Array<{ roomId: string; userCount: number; entries: Array<{ userId: string; timeRemaining: number }> }> = [];

    for (const [roomId, roomGracePeriods] of this.roomGracePeriods.entries()) {
      const entries: Array<{ userId: string; timeRemaining: number }> = [];

      for (const [userId, entry] of roomGracePeriods.entries()) {
        const timeRemaining = Math.max(0, this.GRACE_PERIOD_MS - (now - entry.timestamp));
        if (timeRemaining > 0) {
          entries.push({ userId, timeRemaining });
          totalUsers++;
        }
      }

      if (entries.length > 0) {
        roomBreakdown.push({
          roomId,
          userCount: entries.length,
          entries
        });
      }
    }

    return {
      totalUsers,
      roomCount: this.roomGracePeriods.size,
      roomBreakdown
    };
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredGracePeriods();
    }, 60000); // Clean up every minute
  }

  /**
   * Shutdown and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.roomGracePeriods.clear();
  }
}

// Export singleton instance
export const namespaceGracePeriodManager = new NamespaceGracePeriodManager();