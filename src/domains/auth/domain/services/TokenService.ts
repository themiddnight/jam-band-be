import jwt from 'jsonwebtoken';
import { config } from '../../../../config/environment';

export interface JWTPayload {
  userId: string;
  email: string | null;
  userType: string;
  iat?: number;
  exp?: number;
}

export class TokenService {
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor() {
    this.secret = config.jwt.secret || 'fallback-secret';
    this.expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  }

  generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, this.secret, {
      expiresIn: this.expiresIn,
    } as jwt.SignOptions);
  }

  verifyToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as JWTPayload;
      return decoded;
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  generateEmailVerificationToken(): string {
    const expiresHours = parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_HOURS || '24');
    return jwt.sign(
      { type: 'email_verification', timestamp: Date.now() },
      this.secret,
      { expiresIn: `${expiresHours}h` } as jwt.SignOptions
    );
  }

  generatePasswordResetToken(): string {
    const expiresHours = parseInt(process.env.PASSWORD_RESET_EXPIRES_HOURS || '1');
    return jwt.sign(
      { type: 'password_reset', timestamp: Date.now() },
      this.secret,
      { expiresIn: `${expiresHours}h` } as jwt.SignOptions
    );
  }

  verifyEmailVerificationToken(token: string): boolean {
    try {
      const decoded = jwt.verify(token, this.secret) as any;
      return decoded.type === 'email_verification';
    } catch {
      return false;
    }
  }

  verifyPasswordResetToken(token: string): boolean {
    try {
      const decoded = jwt.verify(token, this.secret) as any;
      return decoded.type === 'password_reset';
    } catch {
      return false;
    }
  }
}

export const tokenService = new TokenService();

