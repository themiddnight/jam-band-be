import { v4 as uuidv4 } from 'uuid';
import { Room, User, UserSession } from '../types';

export class RoomService {
  private rooms = new Map<string, Room>();
  private userSessions = new Map<string, UserSession>();
  private gracePeriodUsers = new Map<string, { roomId: string; timestamp: number; isIntendedLeave: boolean; userData: User }>();
  private readonly GRACE_PERIOD_MS = 60000; // 60 seconds
  private intentionallyLeftUsers = new Map<string, { roomId: string; timestamp: number; userData: User }>();
  private readonly INTENTIONAL_LEAVE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Room management
  createRoom(name: string, username: string, userId: string, isPrivate: boolean = false, isHidden: boolean = false): { room: Room; user: User; session: UserSession } {
    const roomId = uuidv4();
    
    const room: Room = {
      id: roomId,
      name,
      owner: userId,
      users: new Map(),
      pendingMembers: new Map(),
      isPrivate,
      isHidden,
      createdAt: new Date()
    };

    const user: User = {
      id: userId,
      username,
      role: 'room_owner',
      isReady: true
    };

    room.users.set(userId, user);
    this.rooms.set(roomId, room);

    const session: UserSession = { roomId, userId };
    return { room, user, session };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getAllRooms() {
    return Array.from(this.rooms.values())
      .filter(room => !room.isHidden) // Don't show hidden rooms in public list
      .map(room => ({
        id: room.id,
        name: room.name,
        userCount: room.users.size,
        owner: room.owner,
        isPrivate: room.isPrivate,
        isHidden: room.isHidden,
        createdAt: room.createdAt
      }));
  }

  deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
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
    
    return Array.from(room.users.values()).find(u => u.username === username);
  }

  addUserToRoom(roomId: string, user: User): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    
    room.users.set(user.id, user);
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

  removeUserFromRoom(roomId: string, userId: string, isIntendedLeave: boolean = false): User | undefined {
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
        userData: user
      });
    } else {
      // Add to grace period if not intended leave (e.g., page refresh, network issues)
      this.gracePeriodUsers.set(userId, {
        roomId,
        timestamp: Date.now(),
        isIntendedLeave: false,
        userData: user // Store the complete user data including role
      });
    }

    return user;
  }

  // Grace period management
  getGracePeriodMs(): number {
    return this.GRACE_PERIOD_MS;
  }

  isUserInGracePeriod(userId: string, roomId: string): boolean {
    const graceEntry = this.gracePeriodUsers.get(userId);
    if (!graceEntry) return false;

    if (graceEntry.roomId !== roomId) return false;

    const now = Date.now();
    if (now - graceEntry.timestamp > this.GRACE_PERIOD_MS) {
      this.gracePeriodUsers.delete(userId);
      return false;
    }

    return true;
  }

  removeFromGracePeriod(userId: string): void {
    this.gracePeriodUsers.delete(userId);
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

  cleanupExpiredGracePeriod(): void {
    const now = Date.now();
    for (const [userId, entry] of this.gracePeriodUsers.entries()) {
      if (now - entry.timestamp > this.GRACE_PERIOD_MS) {
        this.gracePeriodUsers.delete(userId);
      }
    }
  }

  cleanupExpiredIntentionalLeaves(): void {
    const now = Date.now();
    for (const [userId, entry] of this.intentionallyLeftUsers.entries()) {
      if (now - entry.timestamp > this.INTENTIONAL_LEAVE_EXPIRY_MS) {
        this.intentionallyLeftUsers.delete(userId);
      }
    }
  }

  transferOwnership(roomId: string, newOwnerId: string, oldOwner?: User): { newOwner: User; oldOwner: User } | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const newOwner = room.users.get(newOwnerId);
    
    if (!newOwner) return undefined;

    // If oldOwner is provided, use it; otherwise try to find it in the room
    let actualOldOwner = oldOwner;
    if (!actualOldOwner) {
      actualOldOwner = room.users.get(room.owner);
      if (!actualOldOwner) return undefined;
    }

    room.owner = newOwnerId;
    newOwner.role = 'room_owner';
    
    // Only update oldOwner role if it's still in the room
    if (room.users.has(actualOldOwner.id)) {
      actualOldOwner.role = 'band_member';
    }

    return { newOwner, oldOwner: actualOldOwner };
  }

  // Check if room should be closed (no owner or band members left)
  shouldCloseRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return true;
    
    // Check if there are any room_owner or band_member users
    const hasActiveMembers = Array.from(room.users.values()).some(user => 
      user.role === 'room_owner' || user.role === 'band_member'
    );
    
    return !hasActiveMembers;
  }

  // Get any user in the room for ownership transfer
  getAnyUserInRoom(roomId: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room || room.users.size === 0) return undefined;
    
    // Return the first user in the room
    return Array.from(room.users.values())[0];
  }

  // Session management
  setUserSession(socketId: string, session: UserSession): void {
    this.userSessions.set(socketId, session);
  }

  getUserSession(socketId: string): UserSession | undefined {
    return this.userSessions.get(socketId);
  }

  removeUserSession(socketId: string): boolean {
    return this.userSessions.delete(socketId);
  }

  findSocketByUserId(userId: string): string | undefined {
    for (const [socketId, session] of this.userSessions.entries()) {
      if (session.userId === userId) {
        return socketId;
      }
    }
    return undefined;
  }

  removeOldSessionsForUser(userId: string, currentSocketId: string): void {
    for (const [socketId, session] of this.userSessions.entries()) {
      if (session.userId === userId && socketId !== currentSocketId) {
        this.userSessions.delete(socketId);
      }
    }
  }

  // Room state management
  updateUserInstrument(roomId: string, userId: string, instrument: string, category: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const user = room.users.get(userId);
    if (!user) return false;

    user.currentInstrument = instrument;
    user.currentCategory = category;
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
    
    return Array.from(room.users.values())
      .filter(u => u.role === 'band_member');
  }

  // Cleanup expired grace time entries
  cleanupExpiredGraceTime(): void {
    // Clean up expired grace period entries
    this.cleanupExpiredGracePeriod();
    
    // Clean up expired intentional leave entries
    this.cleanupExpiredIntentionalLeaves();
    
    // Example cleanup logic (can be expanded based on requirements):
    // - Remove rooms that have been empty for too long
    // - Clean up old user sessions
    
    const now = new Date();
    const roomsToDelete: string[] = [];
    
    for (const [roomId, room] of this.rooms.entries()) {
      // Delete rooms that have no owner/band members for more than 1 hour
      const timeSinceCreation = now.getTime() - room.createdAt.getTime();
      const oneHour = 60 * 60 * 1000;
      
      if (this.shouldCloseRoom(roomId) && timeSinceCreation > oneHour) {
        roomsToDelete.push(roomId);
      }
    }
    
    // Delete expired rooms
    roomsToDelete.forEach(roomId => {
      this.rooms.delete(roomId);
      console.log(`Deleted expired room: ${roomId}`);
    });
  }
} 