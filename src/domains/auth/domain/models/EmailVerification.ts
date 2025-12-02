/**
 * Email Verification Domain Model
 */

export interface EmailVerification {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export class EmailVerificationModel {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly token: string,
    public readonly expiresAt: Date,
    public readonly createdAt: Date
  ) {}

  static fromPrisma(data: any): EmailVerificationModel {
    return new EmailVerificationModel(
      data.id,
      data.userId,
      data.token,
      data.expiresAt,
      data.createdAt
    );
  }

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isValid(): boolean {
    return !this.isExpired();
  }
}

