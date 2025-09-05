import { RoomId, UserId } from '../../../../shared/domain/models/ValueObjects';

/**
 * RoomListing Domain Model
 * 
 * Represents a room in the lobby context for discovery and browsing.
 * This is a read-only projection of room data optimized for lobby operations.
 * 
 * Requirements: 3.1, 9.1
 */
export class RoomListing {
  constructor(
    public readonly id: RoomId,
    public readonly name: string,
    public readonly memberCount: number,
    public readonly maxMembers: number,
    public readonly isPrivate: boolean,
    public readonly requiresApproval: boolean,
    public readonly genres: string[],
    public readonly description: string | undefined,
    public readonly owner: UserId,
    public readonly ownerUsername: string,
    public readonly createdAt: Date,
    public readonly lastActivity: Date,
    public readonly isActive: boolean = true
  ) {
    this.validate();
  }

  private validate(): void {
    if (!this.name || this.name.trim().length === 0) {
      throw new Error('Room name cannot be empty');
    }

    if (this.memberCount < 0) {
      throw new Error('Member count cannot be negative');
    }

    if (this.maxMembers < 1) {
      throw new Error('Max members must be at least 1');
    }

    if (this.memberCount > this.maxMembers) {
      throw new Error('Member count cannot exceed max members');
    }
  }

  /**
   * Determines if a user can join this room based on room settings
   */
  canJoin(userId: UserId): boolean {
    // Cannot join if room is full
    if (this.isFull()) {
      return false;
    }

    // Cannot join if room is inactive
    if (!this.isActive) {
      return false;
    }

    // Private rooms require owner approval or being the owner
    if (this.isPrivate && !this.owner.equals(userId)) {
      return this.requiresApproval; // Can attempt to join if approval is enabled
    }

    return true;
  }

  /**
   * Checks if the room is full
   */
  isFull(): boolean {
    return this.memberCount >= this.maxMembers;
  }

  /**
   * Checks if the room is nearly full (80% capacity)
   */
  isNearlyFull(): boolean {
    return this.memberCount >= Math.floor(this.maxMembers * 0.8);
  }

  /**
   * Checks if the room has been recently active (within last 30 minutes)
   */
  isRecentlyActive(): boolean {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    return this.lastActivity > thirtyMinutesAgo;
  }

  /**
   * Gets the room's capacity status
   */
  getCapacityStatus(): RoomCapacityStatus {
    if (this.isFull()) {
      return RoomCapacityStatus.FULL;
    }
    if (this.isNearlyFull()) {
      return RoomCapacityStatus.NEARLY_FULL;
    }
    if (this.memberCount === 0) {
      return RoomCapacityStatus.EMPTY;
    }
    return RoomCapacityStatus.AVAILABLE;
  }

  /**
   * Gets the room's activity status
   */
  getActivityStatus(): RoomActivityStatus {
    if (!this.isActive) {
      return RoomActivityStatus.INACTIVE;
    }
    if (this.isRecentlyActive()) {
      return RoomActivityStatus.ACTIVE;
    }
    return RoomActivityStatus.IDLE;
  }

  /**
   * Checks if the room matches a genre filter
   */
  hasGenre(genre: string): boolean {
    return this.genres.some(g => g.toLowerCase() === genre.toLowerCase());
  }

  /**
   * Checks if the room matches any of the provided genres
   */
  hasAnyGenre(genres: string[]): boolean {
    return genres.some(genre => this.hasGenre(genre));
  }

  /**
   * Checks if the room name contains the search term (case-insensitive)
   */
  matchesSearchTerm(searchTerm: string): boolean {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return true;
    }

    const term = searchTerm.toLowerCase().trim();
    return (
      this.name.toLowerCase().includes(term) ||
      this.ownerUsername.toLowerCase().includes(term) ||
      (this.description && this.description.toLowerCase().includes(term)) ||
      this.genres.some(genre => genre.toLowerCase().includes(term))
    );
  }

  /**
   * Creates a summary for display in room lists
   */
  toSummary(): RoomListingSummary {
    return {
      id: this.id.toString(),
      name: this.name,
      memberCount: this.memberCount,
      maxMembers: this.maxMembers,
      isPrivate: this.isPrivate,
      requiresApproval: this.requiresApproval,
      genres: [...this.genres],
      ownerUsername: this.ownerUsername,
      capacityStatus: this.getCapacityStatus(),
      activityStatus: this.getActivityStatus(),
      canJoinDirectly: !this.isPrivate && !this.isFull() && this.isActive
    };
  }

  equals(other: RoomListing): boolean {
    return this.id.equals(other.id);
  }
}

export enum RoomCapacityStatus {
  EMPTY = 'empty',
  AVAILABLE = 'available',
  NEARLY_FULL = 'nearly_full',
  FULL = 'full'
}

export enum RoomActivityStatus {
  ACTIVE = 'active',
  IDLE = 'idle',
  INACTIVE = 'inactive'
}

export interface RoomListingSummary {
  id: string;
  name: string;
  memberCount: number;
  maxMembers: number;
  isPrivate: boolean;
  requiresApproval: boolean;
  genres: string[];
  ownerUsername: string;
  capacityStatus: RoomCapacityStatus;
  activityStatus: RoomActivityStatus;
  canJoinDirectly: boolean;
}