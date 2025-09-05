import { UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * Member entity representing a user's membership in a room
 * 
 * Requirements: 1.1, 1.2
 */
export class Member {
  constructor(
    public readonly userId: UserId,
    public readonly username: string,
    public readonly role: MemberRole,
    public readonly joinedAt: Date = new Date()
  ) {}

  equals(other: Member): boolean {
    return this.userId.equals(other.userId);
  }

  hasRole(role: MemberRole): boolean {
    return this.role === role;
  }

  canKickOthers(): boolean {
    return this.role === MemberRole.OWNER || this.role === MemberRole.MODERATOR;
  }

  canChangeSettings(): boolean {
    return this.role === MemberRole.OWNER;
  }
}

/**
 * Member roles within a room
 */
export enum MemberRole {
  OWNER = 'owner',
  MODERATOR = 'moderator',
  BAND_MEMBER = 'band_member',
  AUDIENCE = 'audience'
}