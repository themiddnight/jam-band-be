/**
 * Password Reset Domain Model
 */

export interface PasswordReset {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

export class PasswordResetModel {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly token: string,
    public readonly expiresAt: Date,
    public readonly createdAt: Date,
    public usedAt: Date | null
  ) {}

  static fromPrisma(data: any): PasswordResetModel {
    return new PasswordResetModel(
      data.id,
      data.userId,
      data.token,
      data.expiresAt,
      data.createdAt,
      data.usedAt
    );
  }

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isUsed(): boolean {
    return this.usedAt !== null;
  }

  isValid(): boolean {
    return !this.isExpired() && !this.isUsed();
  }

  markAsUsed(): void {
    (this as any).usedAt = new Date();
  }
}

