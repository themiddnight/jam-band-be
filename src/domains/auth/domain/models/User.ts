/**
 * Auth User Domain Model
 * 
 * Represents an authenticated user in the system with email, password, and OAuth accounts.
 */

export enum UserType {
  GUEST = 'GUEST',
  REGISTERED = 'REGISTERED',
  PREMIUM = 'PREMIUM'
}

export interface AuthUser {
  id: string;
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: UserType;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthUserModel {
  constructor(
    public readonly id: string,
    public email: string | null,
    public username: string | null,
    public passwordHash: string | null,
    public emailVerified: boolean,
    public userType: UserType,
    public readonly createdAt: Date,
    public updatedAt: Date
  ) {}

  static fromPrisma(data: any): AuthUserModel {
    return new AuthUserModel(
      data.id,
      data.email,
      data.username,
      data.passwordHash,
      data.emailVerified,
      data.userType as UserType,
      data.createdAt,
      data.updatedAt
    );
  }

  isGuest(): boolean {
    return this.userType === UserType.GUEST;
  }

  isRegistered(): boolean {
    return this.userType === UserType.REGISTERED;
  }

  isPremium(): boolean {
    return this.userType === UserType.PREMIUM;
  }

  canSavePresets(): boolean {
    return !this.isGuest();
  }

  canJoinPrivateRooms(): boolean {
    return !this.isGuest();
  }
}

