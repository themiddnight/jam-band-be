import { AggregateRoot } from '../../../../shared/domain/models/AggregateRoot';
import { UserId } from '../../../../shared/domain/models/ValueObjects';
import { UserCreated, UserProfileUpdated } from '../../../../shared/domain/events/UserEvents';

/**
 * User Aggregate Root
 * 
 * Manages user identity, profile, and permissions.
 * 
 * Requirements: 1.1, 1.2
 */
export class User extends AggregateRoot {
  private constructor(
    private readonly _id: UserId,
    private _username: string,
    private _profile: UserProfile,
    private _permissions: Set<Permission>,
    private readonly _createdAt: Date = new Date()
  ) {
    super();
  }

  // Factory method for creating new users
  static create(username: string, profile?: UserProfile): User {
    if (!username || username.trim().length === 0) {
      throw new UserCreationError('Username cannot be empty');
    }

    if (username.length < 3 || username.length > 30) {
      throw new UserCreationError('Username must be between 3 and 30 characters');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new UserCreationError('Username can only contain letters, numbers, underscores, and hyphens');
    }

    const userId = UserId.generate();
    const userProfile = profile || UserProfile.default();
    const permissions = new Set<Permission>([Permission.JOIN_ROOMS, Permission.CREATE_ROOMS]);

    const user = new User(userId, username.trim(), userProfile, permissions);

    // Publish domain event
    user.addDomainEvent(new UserCreated(
      userId.toString(),
      username.trim()
    ));

    return user;
  }

  // Getters
  get id(): UserId {
    return this._id;
  }

  get username(): string {
    return this._username;
  }

  get profile(): UserProfile {
    return this._profile;
  }

  get permissions(): Permission[] {
    return Array.from(this._permissions);
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  // Business methods
  updateProfile(newProfile: UserProfile): void {
    const changes = this.getProfileChanges(this._profile, newProfile);
    if (Object.keys(changes).length === 0) {
      return; // No changes
    }

    this._profile = newProfile;

    this.addDomainEvent(new UserProfileUpdated(
      this._id.toString(),
      changes
    ));
  }

  grantPermission(permission: Permission): void {
    if (this._permissions.has(permission)) {
      return; // Already has permission
    }

    this._permissions.add(permission);
  }

  revokePermission(permission: Permission): void {
    this._permissions.delete(permission);
  }

  // Query methods
  hasPermission(permission: Permission): boolean {
    return this._permissions.has(permission);
  }

  canKickUser(targetUser: User, _room: any): boolean {
    // Basic permission check - can be extended with more complex logic
    return this.hasPermission(Permission.KICK_USERS) && !targetUser.id.equals(this.id);
  }

  canCreateRoom(): boolean {
    return this.hasPermission(Permission.CREATE_ROOMS);
  }

  canJoinRoom(): boolean {
    return this.hasPermission(Permission.JOIN_ROOMS);
  }

  private getProfileChanges(oldProfile: UserProfile, newProfile: UserProfile): Record<string, any> {
    const changes: Record<string, any> = {};

    if (oldProfile.displayName !== newProfile.displayName) {
      changes.displayName = { from: oldProfile.displayName, to: newProfile.displayName };
    }

    if (oldProfile.bio !== newProfile.bio) {
      changes.bio = { from: oldProfile.bio, to: newProfile.bio };
    }

    if (oldProfile.avatarUrl !== newProfile.avatarUrl) {
      changes.avatarUrl = { from: oldProfile.avatarUrl, to: newProfile.avatarUrl };
    }

    if (oldProfile.preferredInstruments.length !== newProfile.preferredInstruments.length ||
        !oldProfile.preferredInstruments.every(i => newProfile.preferredInstruments.includes(i))) {
      changes.preferredInstruments = { from: oldProfile.preferredInstruments, to: newProfile.preferredInstruments };
    }

    return changes;
  }
}

/**
 * User Profile Value Object
 */
export class UserProfile {
  constructor(
    public readonly displayName?: string,
    public readonly bio?: string,
    public readonly avatarUrl?: string,
    public readonly preferredInstruments: string[] = []
  ) {}

  static default(): UserProfile {
    return new UserProfile();
  }

  equals(other: UserProfile): boolean {
    return this.displayName === other.displayName &&
           this.bio === other.bio &&
           this.avatarUrl === other.avatarUrl &&
           this.preferredInstruments.length === other.preferredInstruments.length &&
           this.preferredInstruments.every(i => other.preferredInstruments.includes(i));
  }
}

/**
 * User Permissions Enum
 */
export enum Permission {
  CREATE_ROOMS = 'create_rooms',
  JOIN_ROOMS = 'join_rooms',
  KICK_USERS = 'kick_users',
  MODERATE_ROOMS = 'moderate_rooms',
  ADMIN = 'admin'
}

// Domain Exceptions
export class UserCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserCreationError';
  }
}