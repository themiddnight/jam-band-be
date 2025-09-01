import { AggregateRoot } from '../../../../shared/domain/models/AggregateRoot';
import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';
import { 
  RoomCreated, 
  MemberJoined, 
  MemberLeft, 
  OwnershipTransferred, 
  RoomSettingsUpdated,
  RoomClosed 
} from '../../../../shared/domain/events/RoomEvents';
import { Member, MemberRole } from './Member';
import { RoomSettings } from './RoomSettings';

/**
 * Room Aggregate Root
 * 
 * Manages room lifecycle, membership, and settings while publishing
 * domain events to coordinate with other bounded contexts.
 * 
 * Requirements: 1.1, 1.2, 5.1
 */
export class Room extends AggregateRoot {
  private constructor(
    private readonly _id: RoomId,
    private _name: string,
    private _owner: UserId,
    private _members: Map<string, Member>,
    private _settings: RoomSettings,
    private readonly _createdAt: Date = new Date()
  ) {
    super();
  }

  // Factory method for creating new rooms
  static create(name: string, owner: UserId, settings?: RoomSettings): Room {
    if (!name || name.trim().length === 0) {
      throw new RoomCreationError('Room name cannot be empty');
    }

    if (name.length > 100) {
      throw new RoomCreationError('Room name cannot exceed 100 characters');
    }

    const roomId = RoomId.generate();
    const roomSettings = settings || RoomSettings.default();
    const members = new Map<string, Member>();

    const room = new Room(roomId, name.trim(), owner, members, roomSettings);

    // Add owner as first member
    const ownerMember = new Member(owner, 'Owner', MemberRole.OWNER);
    room._members.set(owner.toString(), ownerMember);

    // Publish domain event
    room.addDomainEvent(new RoomCreated(
      roomId.toString(),
      owner.toString(),
      name.trim(),
      roomSettings.isPrivate
    ));

    return room;
  }

  // Getters
  get id(): RoomId {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get owner(): UserId {
    return this._owner;
  }

  get settings(): RoomSettings {
    return this._settings;
  }

  get members(): Member[] {
    return Array.from(this._members.values());
  }

  get memberCount(): number {
    return this._members.size;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  // Business methods
  addMember(userId: UserId, username: string, role: MemberRole = MemberRole.BAND_MEMBER): void {
    if (this._members.has(userId.toString())) {
      throw new MemberAlreadyInRoomError(userId.toString());
    }

    if (this._members.size >= this._settings.maxMembers) {
      throw new RoomFullError();
    }

    if (role === MemberRole.AUDIENCE && !this._settings.allowAudience) {
      throw new AudienceNotAllowedError();
    }

    const member = new Member(userId, username, role);
    this._members.set(userId.toString(), member);

    this.addDomainEvent(new MemberJoined(
      this._id.toString(),
      userId.toString(),
      username,
      role
    ));
  }

  removeMember(userId: UserId): void {
    const member = this._members.get(userId.toString());
    if (!member) {
      throw new UserNotInRoomError(userId.toString());
    }

    if (userId.equals(this._owner)) {
      throw new CannotRemoveOwnerError();
    }

    this._members.delete(userId.toString());

    this.addDomainEvent(new MemberLeft(
      this._id.toString(),
      userId.toString(),
      member.username
    ));
  }

  transferOwnership(newOwnerId: UserId): void {
    const newOwnerMember = this._members.get(newOwnerId.toString());
    if (!newOwnerMember) {
      throw new UserNotInRoomError(newOwnerId.toString());
    }

    const previousOwnerId = this._owner;

    // Update owner
    this._owner = newOwnerId;

    // Update member roles
    const updatedNewOwner = new Member(newOwnerId, newOwnerMember.username, MemberRole.OWNER, newOwnerMember.joinedAt);
    this._members.set(newOwnerId.toString(), updatedNewOwner);

    const previousOwnerMember = this._members.get(previousOwnerId.toString());
    if (previousOwnerMember) {
      const updatedPreviousOwner = new Member(
        previousOwnerId, 
        previousOwnerMember.username, 
        MemberRole.BAND_MEMBER, 
        previousOwnerMember.joinedAt
      );
      this._members.set(previousOwnerId.toString(), updatedPreviousOwner);
    }

    this.addDomainEvent(new OwnershipTransferred(
      this._id.toString(),
      previousOwnerId.toString(),
      newOwnerId.toString()
    ));
  }

  updateSettings(newSettings: RoomSettings, updatedBy: UserId): void {
    if (!this.canUserChangeSettings(updatedBy)) {
      throw new InsufficientPermissionsError('Only room owner can change settings');
    }

    const changes = this.getSettingsChanges(this._settings, newSettings);
    if (Object.keys(changes).length === 0) {
      return; // No changes
    }

    this._settings = newSettings;

    this.addDomainEvent(new RoomSettingsUpdated(
      this._id.toString(),
      updatedBy.toString(),
      changes
    ));
  }

  closeRoom(closedBy: UserId, reason?: string): void {
    if (!closedBy.equals(this._owner)) {
      throw new InsufficientPermissionsError('Only room owner can close the room');
    }

    this.addDomainEvent(new RoomClosed(
      this._id.toString(),
      closedBy.toString(),
      reason
    ));
  }

  // Query methods
  hasMember(userId: UserId): boolean {
    return this._members.has(userId.toString());
  }

  getMember(userId: UserId): Member | null {
    return this._members.get(userId.toString()) || null;
  }

  isOwner(userId: UserId): boolean {
    return this._owner.equals(userId);
  }

  canUserJoin(userId: UserId, role: MemberRole): boolean {
    if (this._members.has(userId.toString())) {
      return false; // Already in room
    }

    if (this._members.size >= this._settings.maxMembers) {
      return false; // Room full
    }

    if (role === MemberRole.AUDIENCE && !this._settings.allowAudience) {
      return false; // Audience not allowed
    }

    return true;
  }

  canUserChangeSettings(userId: UserId): boolean {
    return this.isOwner(userId);
  }

  canUserKickMember(userId: UserId, targetUserId: UserId): boolean {
    if (userId.equals(targetUserId)) {
      return false; // Cannot kick self
    }

    if (targetUserId.equals(this._owner)) {
      return false; // Cannot kick owner
    }

    const member = this._members.get(userId.toString());
    return member?.canKickOthers() || false;
  }

  private getSettingsChanges(oldSettings: RoomSettings, newSettings: RoomSettings): Record<string, any> {
    const changes: Record<string, any> = {};

    if (oldSettings.maxMembers !== newSettings.maxMembers) {
      changes.maxMembers = { from: oldSettings.maxMembers, to: newSettings.maxMembers };
    }

    if (oldSettings.isPrivate !== newSettings.isPrivate) {
      changes.isPrivate = { from: oldSettings.isPrivate, to: newSettings.isPrivate };
    }

    if (oldSettings.allowAudience !== newSettings.allowAudience) {
      changes.allowAudience = { from: oldSettings.allowAudience, to: newSettings.allowAudience };
    }

    if (oldSettings.requireApproval !== newSettings.requireApproval) {
      changes.requireApproval = { from: oldSettings.requireApproval, to: newSettings.requireApproval };
    }

    if (!oldSettings.equals(newSettings)) {
      // Check genres and description changes
      if (oldSettings.genres.length !== newSettings.genres.length || 
          !oldSettings.genres.every(g => newSettings.genres.includes(g))) {
        changes.genres = { from: oldSettings.genres, to: newSettings.genres };
      }

      if (oldSettings.description !== newSettings.description) {
        changes.description = { from: oldSettings.description, to: newSettings.description };
      }
    }

    return changes;
  }
}

// Domain Exceptions
export class RoomCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomCreationError';
  }
}

export class RoomFullError extends Error {
  constructor() {
    super('Room has reached maximum capacity');
    this.name = 'RoomFullError';
  }
}

export class UserNotInRoomError extends Error {
  constructor(userId: string) {
    super(`User ${userId} is not in the room`);
    this.name = 'UserNotInRoomError';
  }
}

export class MemberAlreadyInRoomError extends Error {
  constructor(userId: string) {
    super(`User ${userId} is already in the room`);
    this.name = 'MemberAlreadyInRoomError';
  }
}

export class InsufficientPermissionsError extends Error {
  constructor(action: string) {
    super(`Insufficient permissions: ${action}`);
    this.name = 'InsufficientPermissionsError';
  }
}

export class CannotRemoveOwnerError extends Error {
  constructor() {
    super('Cannot remove room owner. Transfer ownership first.');
    this.name = 'CannotRemoveOwnerError';
  }
}

export class AudienceNotAllowedError extends Error {
  constructor() {
    super('Audience members are not allowed in this room');
    this.name = 'AudienceNotAllowedError';
  }
}