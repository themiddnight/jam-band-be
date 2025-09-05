/**
 * Room settings value object
 * 
 * Encapsulates room configuration and validation rules.
 * 
 * Requirements: 1.1, 1.2
 */
export class RoomSettings {
  constructor(
    public readonly maxMembers: number = 8,
    public readonly isPrivate: boolean = false,
    public readonly allowAudience: boolean = true,
    public readonly requireApproval: boolean = false,
    public readonly genres: string[] = [],
    public readonly description?: string
  ) {
    this.validate();
  }

  static default(): RoomSettings {
    return new RoomSettings();
  }

  static create(options: Partial<RoomSettingsOptions>): RoomSettings {
    return new RoomSettings(
      options.maxMembers,
      options.isPrivate,
      options.allowAudience,
      options.requireApproval,
      options.genres,
      options.description
    );
  }

  private validate(): void {
    if (this.maxMembers < 1 || this.maxMembers > 50) {
      throw new Error('Max members must be between 1 and 50');
    }

    if (this.genres.length > 10) {
      throw new Error('Cannot have more than 10 genres');
    }

    if (this.description && this.description.length > 500) {
      throw new Error('Description cannot exceed 500 characters');
    }
  }

  updateMaxMembers(maxMembers: number): RoomSettings {
    return new RoomSettings(
      maxMembers,
      this.isPrivate,
      this.allowAudience,
      this.requireApproval,
      this.genres,
      this.description
    );
  }

  updatePrivacy(isPrivate: boolean): RoomSettings {
    return new RoomSettings(
      this.maxMembers,
      isPrivate,
      this.allowAudience,
      this.requireApproval,
      this.genres,
      this.description
    );
  }

  addGenre(genre: string): RoomSettings {
    if (this.genres.includes(genre)) {
      return this;
    }

    return new RoomSettings(
      this.maxMembers,
      this.isPrivate,
      this.allowAudience,
      this.requireApproval,
      [...this.genres, genre],
      this.description
    );
  }

  removeGenre(genre: string): RoomSettings {
    return new RoomSettings(
      this.maxMembers,
      this.isPrivate,
      this.allowAudience,
      this.requireApproval,
      this.genres.filter(g => g !== genre),
      this.description
    );
  }

  equals(other: RoomSettings): boolean {
    return (
      this.maxMembers === other.maxMembers &&
      this.isPrivate === other.isPrivate &&
      this.allowAudience === other.allowAudience &&
      this.requireApproval === other.requireApproval &&
      this.genres.length === other.genres.length &&
      this.genres.every(genre => other.genres.includes(genre)) &&
      this.description === other.description
    );
  }
}

export interface RoomSettingsOptions {
  maxMembers?: number;
  isPrivate?: boolean;
  allowAudience?: boolean;
  requireApproval?: boolean;
  genres?: string[];
  description?: string;
}