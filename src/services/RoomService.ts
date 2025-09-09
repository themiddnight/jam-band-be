import { v4 as uuidv4 } from "uuid";
import { Room, User, UserSession } from "../types";
import { CacheService } from "./CacheService";
import { RoomSessionManager } from "./RoomSessionManager";
import { namespaceGracePeriodManager } from "./NamespaceGracePeriodManager";
import { METRONOME_CONSTANTS } from "../constants";

export class RoomService {
  private rooms = new Map<string, Room>();
  private intentionallyLeftUsers = new Map<
    string,
    { roomId: string; timestamp: number; userData: User }
  >();
  private readonly INTENTIONAL_LEAVE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private cacheService = CacheService.getInstance();
  private roomSessionManager: RoomSessionManager;

  constructor(roomSessionManager: RoomSessionManager) {
    this.roomSessionManager = roomSessionManager;
  }

  // Room management
  createRoom(
    name: string,
    username: string,
    userId: string,
    isPrivate: boolean = false,
    isHidden: boolean = false
  ): { room: Room; user: User; session: UserSession } {
    const roomId = uuidv4();

    const room: Room = {
      id: roomId,
      name,
      owner: userId,
      users: new Map(),
      pendingMembers: new Map(),
      isPrivate,
      isHidden,
      createdAt: new Date(),
      metronome: {
        bpm: METRONOME_CONSTANTS.DEFAULT_BPM,
        lastTickTimestamp: Date.now(),
      },
    };

    const user: User = {
      id: userId,
      username,
      role: "room_owner",
      isReady: true,
    };

    room.users.set(userId, user);
    this.rooms.set(roomId, room);

    // Cache the new room
    this.cacheService.cacheRoom(roomId, room);

    // Invalidate room list cache
    this.cacheService.invalidateRoomCaches();

    const session: UserSession = { roomId, userId };
    return { room, user, session };
  }

  getRoom(roomId: string): Room | undefined {
    // Try cache first
    const cachedRoom = this.cacheService.getCachedRoom(roomId);
    if (cachedRoom) {
      return cachedRoom;
    }

    // Get from memory and cache
    const room = this.rooms.get(roomId);
    if (room) {
      this.cacheService.cacheRoom(roomId, room);
    }

    return room;
  }

  getAllRooms() {
    // Try cache first
    const cacheKey = "all_rooms_public";
    const cachedRooms = this.cacheService.getCachedRoomList(cacheKey);
    if (cachedRooms) {
      return cachedRooms;
    }

    // Get from memory and cache
    const rooms = Array.from(this.rooms.values())
      .filter((room) => !room.isHidden) // Don't show hidden rooms in public list
      .map((room) => {
        // Include users in grace period in the count to prevent ghost rooms
        // but exclude users who have intentionally left
        const gracePeriodUsers =
          namespaceGracePeriodManager.getRoomGracePeriodUsers(room.id);
        const validGracePeriodUsers = gracePeriodUsers.filter((entry) => {
          // Check if this user is in the intentionally left list
          const intentionallyLeft = this.intentionallyLeftUsers.get(
            entry.userId
          );
          if (intentionallyLeft && intentionallyLeft.roomId === room.id) {
            // Check if the intentional leave is still valid (within 24 hours)
            const isStillValid =
              Date.now() - intentionallyLeft.timestamp <
              this.INTENTIONAL_LEAVE_EXPIRY_MS;
            return !isStillValid; // Only count if the intentional leave has expired
          }
          return true; // Count users who haven't intentionally left
        });

        const totalUserCount = room.users.size + validGracePeriodUsers.length;

        return {
          id: room.id,
          name: room.name,
          userCount: totalUserCount,
          owner: room.owner,
          isPrivate: room.isPrivate,
          isHidden: room.isHidden,
          createdAt: room.createdAt,
        };
      })
      .filter((room) => room.userCount > 0); // Filter out rooms with no users (including grace period)

    // Cache for 1 minute since room list changes frequently
    this.cacheService.cacheRoomList(cacheKey, rooms, 60);

    return rooms;
  }

  deleteRoom(roomId: string): boolean {
    const deleted = this.rooms.delete(roomId);
    if (deleted) {
      // Clear room cache
      this.cacheService.invalidateRoom(roomId);
      // Invalidate room list cache
      this.cacheService.invalidateRoomCaches();
    }
    return deleted;
  }

  // User management
  findUserInRoom(roomId: string, userId: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    return room.users.get(userId);
  }

  findUserInRoomByUsername(roomId: string, username: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    return Array.from(room.users.values()).find((u) => u.username === username);
  }

  addUserToRoom(roomId: string, user: User): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.users.set(user.id, user);

    // Remove from intentionally left list if they were there
    this.removeFromIntentionallyLeft(user.id);

    // Invalidate caches since user count has changed
    this.cacheService.invalidateRoom(roomId);
    this.cacheService.invalidateRoomCaches();

    return true;
  }

  addPendingMember(roomId: string, user: User): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.pendingMembers.set(user.id, user);
    return true;
  }

  approveMember(roomId: string, userId: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const pendingUser = room.pendingMembers.get(userId);
    if (!pendingUser) return undefined;

    room.pendingMembers.delete(userId);
    room.users.set(userId, pendingUser);
    return pendingUser;
  }

  rejectMember(roomId: string, userId: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const pendingUser = room.pendingMembers.get(userId);
    if (!pendingUser) return undefined;

    room.pendingMembers.delete(userId);
    return pendingUser;
  }

  removeUserFromRoom(
    roomId: string,
    userId: string,
    isIntendedLeave: boolean = false
  ): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    const user = room.users.get(userId);
    if (!user) {
      return undefined;
    }

    room.users.delete(userId);
    room.pendingMembers.delete(userId);

    if (isIntendedLeave) {
      // For intentional leave, add to intentionally left users list
      // This prevents automatic rejoining without approval
      this.intentionallyLeftUsers.set(userId, {
        roomId,
        timestamp: Date.now(),
        userData: user,
      });

      // Also remove from grace period if they were there from a previous disconnection
      namespaceGracePeriodManager.removeFromGracePeriod(userId, roomId);
    } else {
      // Add to namespace-aware grace period if not intended leave (e.g., page refresh, network issues)
      // Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
      namespaceGracePeriodManager.addToGracePeriod(
        userId,
        roomId,
        `/room/${roomId}`,
        user,
        false
      );
    }

    // Invalidate caches since user count has changed
    this.cacheService.invalidateRoom(roomId);
    this.cacheService.invalidateRoomCaches();

    return user;
  }

  // Grace period management - now namespace-aware
  // Requirements: 6.5 - Namespace-aware grace period management (isolated per room)
  getGracePeriodMs(): number {
    return namespaceGracePeriodManager.getGracePeriodMs();
  }

  isUserInGracePeriod(userId: string, roomId: string): boolean {
    // Use namespace-aware grace period manager
    const isInNamespaceGracePeriod =
      namespaceGracePeriodManager.isUserInGracePeriod(userId, roomId);

    return isInNamespaceGracePeriod;
  }

  removeFromGracePeriod(userId: string, roomId?: string): void {
    // Remove from namespace-aware grace period
    if (roomId) {
      namespaceGracePeriodManager.removeFromGracePeriod(userId, roomId);
    }
  }

  /**
   * Get grace period entry with user data for restoration
   * Requirements: 6.7 - State restoration (user role, instrument, settings) after reconnection
   */
  getGracePeriodUserData(userId: string, roomId: string): User | null {
    // Try namespace-aware grace period first
    const namespaceEntry = namespaceGracePeriodManager.getGracePeriodEntry(
      userId,
      roomId
    );
    if (namespaceEntry) {
      return namespaceEntry.userData;
    }

    return null;
  }

  // Intentional leave management
  hasUserIntentionallyLeft(userId: string, roomId: string): boolean {
    const intentionalEntry = this.intentionallyLeftUsers.get(userId);
    if (!intentionalEntry) return false;

    if (intentionalEntry.roomId !== roomId) return false;

    const now = Date.now();
    if (now - intentionalEntry.timestamp > this.INTENTIONAL_LEAVE_EXPIRY_MS) {
      this.intentionallyLeftUsers.delete(userId);
      return false;
    }

    return true;
  }

  removeFromIntentionallyLeft(userId: string): void {
    this.intentionallyLeftUsers.delete(userId);
  }

  cleanupExpiredGracePeriod(): { roomsToDelete: string[] } {
    // Clean up namespace-aware grace periods and get rooms that may need cleanup
    const roomsNeedingCleanup =
      namespaceGracePeriodManager.cleanupExpiredGracePeriods();

    // Check which rooms should actually be deleted after grace period cleanup
    const roomsToDelete: string[] = [];
    for (const roomId of roomsNeedingCleanup) {
      if (this.shouldCloseRoom(roomId)) {
        roomsToDelete.push(roomId);
      }
    }

    return { roomsToDelete };
  }

  cleanupExpiredIntentionalLeaves(): void {
    const now = Date.now();
    for (const [userId, entry] of this.intentionallyLeftUsers.entries()) {
      if (now - entry.timestamp > this.INTENTIONAL_LEAVE_EXPIRY_MS) {
        this.intentionallyLeftUsers.delete(userId);
      }
    }
  }

  transferOwnership(
    roomId: string,
    newOwnerId: string,
    oldOwner?: User
  ): { newOwner: User; oldOwner: User } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    // Try to find the requested new owner; if not present, fall back to the first
    // eligible user in the room (excluding the old owner if possible).
    let newOwner = room.users.get(newOwnerId);

    if (!newOwner) {
      // Select first available user that is not the current owner (if any)
      for (const user of room.users.values()) {
        if (user.id !== room.owner) {
          newOwner = user;
          break;
        }
      }
      // If still not found and there is at least one user, pick the first
      if (!newOwner && room.users.size > 0) {
        newOwner = Array.from(room.users.values())[0];
      }
    }

    if (!newOwner) return undefined;

    // If oldOwner is provided, use it; otherwise try to find it in the room (may have been removed)
    let actualOldOwner = oldOwner;
    if (!actualOldOwner) {
      actualOldOwner =
        room.users.get(room.owner) ||
        ({ id: room.owner, username: "", role: "audience" } as User);
      // Note: actualOldOwner may be a stub if the old owner was removed already
    }

    // Perform ownership update
    room.owner = newOwner.id;
    newOwner.role = "room_owner";

    // If the old owner is still present in the room, demote them to band_member
    if (actualOldOwner && room.users.has(actualOldOwner.id)) {
      const foundOld = room.users.get(actualOldOwner.id)!;
      foundOld.role = "band_member";
      actualOldOwner = foundOld;
    }

    return { newOwner, oldOwner: actualOldOwner };
  }

  // Check if room should be closed (no users left at all)
  shouldCloseRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return true;

    // Check if there are ANY users currently in room (any role)
    const hasActiveUsers = room.users.size > 0;

    // Also check users in grace period who might return (any role)
    // but exclude users who have intentionally left
    const gracePeriodUsers =
      namespaceGracePeriodManager.getRoomGracePeriodUsers(roomId);
    const validGracePeriodUsers = gracePeriodUsers.filter((entry) => {
      // Check if this user is in the intentionally left list
      const intentionallyLeft = this.intentionallyLeftUsers.get(entry.userId);
      if (intentionallyLeft && intentionallyLeft.roomId === roomId) {
        // Check if the intentional leave is still valid (within 24 hours)
        const isStillValid =
          Date.now() - intentionallyLeft.timestamp <
          this.INTENTIONAL_LEAVE_EXPIRY_MS;
        return !isStillValid; // Only count if the intentional leave has expired
      }
      return true; // Count users who haven't intentionally left
    });
    const hasValidGracePeriodUsers = validGracePeriodUsers.length > 0;

    // Room should only be closed if there are NO users at all (active OR valid grace period)
    // This ensures immediate cleanup when all users leave or all grace periods expire
    return !hasActiveUsers && !hasValidGracePeriodUsers;
  }

  // Get any user in the room for ownership transfer
  getAnyUserInRoom(roomId: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room || room.users.size === 0) return undefined;

    // Return the first user in the room
    return Array.from(room.users.values())[0];
  }

  // Session management - delegated to RoomSessionManager
  setUserSession(socketId: string, session: UserSession): void {
    this.roomSessionManager.setRoomSession(session.roomId, socketId, session);
  }

  getUserSession(socketId: string): UserSession | undefined {
    const namespaceSession = this.roomSessionManager.getRoomSession(socketId);
    if (!namespaceSession) {
      return undefined;
    }
    return {
      roomId: namespaceSession.roomId,
      userId: namespaceSession.userId,
    };
  }

  removeUserSession(socketId: string): boolean {
    return this.roomSessionManager.removeSession(socketId);
  }

  findSocketByUserId(userId: string, roomId?: string): string | undefined {
    // If roomId is provided, search in that specific room
    if (roomId) {
      return this.roomSessionManager.findSocketByUserId(roomId, userId);
    }

    // Otherwise, search across all rooms (for backward compatibility)
    for (const [currentRoomId] of this.rooms.entries()) {
      const socketId = this.roomSessionManager.findSocketByUserId(
        currentRoomId,
        userId
      );
      if (socketId) {
        return socketId;
      }
    }
    return undefined;
  }

  removeOldSessionsForUser(userId: string, currentSocketId: string): void {
    this.roomSessionManager.removeOldSessionsForUser(userId, currentSocketId);
  }

  // Room state management
  updateUserInstrument(
    roomId: string,
    userId: string,
    instrument: string,
    category: string
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const user = room.users.get(userId);
    if (!user) return false;

    user.currentInstrument = instrument;
    user.currentCategory = category;
    return true;
  }

  updateUserSynthParams(
    roomId: string,
    userId: string,
    synthParams: Record<string, any>
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const user = room.users.get(userId);
    if (!user) return false;

    user.synthParams = synthParams;
    return true;
  }

  // Utility methods
  isRoomOwner(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    return room?.owner === userId;
  }

  getRoomUsers(roomId: string): User[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.users.values()) : [];
  }

  getPendingMembers(roomId: string): User[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.pendingMembers.values()) : [];
  }

  getBandMembers(roomId: string): User[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.users.values()).filter(
      (u) => u.role === "band_member"
    );
  }

  // Cleanup expired grace time entries and handle room cleanup
  cleanupExpiredGraceTime(): string[] {
    // Clean up expired grace period entries and get rooms to delete
    const { roomsToDelete: gracePeriodRoomsToDelete } =
      this.cleanupExpiredGracePeriod();

    // Clean up expired intentional leave entries
    this.cleanupExpiredIntentionalLeaves();

    // Immediate cleanup: Remove any rooms that have no active users and no grace users
    const immediateRoomsToDelete: string[] = [];

    for (const [roomId] of this.rooms.entries()) {
      if (this.shouldCloseRoom(roomId)) {
        immediateRoomsToDelete.push(roomId);
      }
    }

    // Combine all rooms to delete (ensure uniqueness)
    const allRoomsToDelete = Array.from(new Set([
      ...gracePeriodRoomsToDelete,
      ...immediateRoomsToDelete,
    ]));

    // Delete rooms and return list for external cleanup (namespaces, etc.)
    allRoomsToDelete.forEach((roomId) => {
      this.deleteRoom(roomId);
      console.log(`Deleted empty room: ${roomId}`);
    });

    return allRoomsToDelete;
  }

  // Metronome management
  updateMetronomeBPM(roomId: string, bpm: number): Room | null {
    const room = this.getRoom(roomId);
    if (!room) return null;

    room.metronome.bpm = Math.max(
      METRONOME_CONSTANTS.MIN_BPM,
      Math.min(METRONOME_CONSTANTS.MAX_BPM, bpm)
    ); // Clamp between 1-1000 BPM
    room.metronome.lastTickTimestamp = Date.now();

    // Update cache
    this.cacheService.cacheRoom(roomId, room);

    return room;
  }

  getMetronomeState(
    roomId: string
  ): { bpm: number; lastTickTimestamp: number } | null {
    const room = this.getRoom(roomId);
    if (!room) return null;

    return {
      bpm: room.metronome.bpm,
      lastTickTimestamp: room.metronome.lastTickTimestamp,
    };
  }
}
