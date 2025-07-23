import { v4 as uuidv4 } from 'uuid';
import { Room, User, UserSession } from '../types';

export class RoomService {
  private rooms = new Map<string, Room>();
  private userSessions = new Map<string, UserSession>();

  // Room management
  createRoom(name: string, username: string): { room: Room; user: User; session: UserSession } {
    const roomId = uuidv4();
    const userId = uuidv4();
    
    const room: Room = {
      id: roomId,
      name,
      owner: userId,
      users: new Map(),
      pendingMembers: new Map(),

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
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      userCount: room.users.size,
      owner: room.owner,
      createdAt: room.createdAt
    }));
  }

  deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  // User management
  findUserInRoom(roomId: string, username: string): User | undefined {
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

  removeUserFromRoom(roomId: string, userId: string): User | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const user = room.users.get(userId);
    if (!user) return undefined;

    room.users.delete(userId);
    room.pendingMembers.delete(userId);
    return user;
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

  // Check if room should be closed (no users left)
  shouldCloseRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return true;
    
    return room.users.size === 0;
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
} 