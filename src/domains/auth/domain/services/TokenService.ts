import jwt from 'jsonwebtoken';
import { config } from '../../../../config/environment';

export interface JWTPayload {
  userId: string;
  email: string | null;
  userType: string;
  iat?: number;
  exp?: number;
  type?: string; // 'refresh' for refresh tokens
}

export class TokenService {
  private readonly secret: string;
  private readonly accessTokenExpiresIn: string;
  private readonly refreshTokenExpiresIn: string;

  constructor() {
    this.secret = config.jwt.secret || 'fallback-secret';
    this.accessTokenExpiresIn = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h';
    this.refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
  }

  // Generate access token (short-lived, 1 hour)
  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'type'>): string {
    return jwt.sign(payload, this.secret, {
      expiresIn: this.accessTokenExpiresIn,
    } as jwt.SignOptions);
  }

  // Generate refresh token (long-lived, 7 days)
  generateRefreshToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'type'>): string {
    return jwt.sign(
      { ...payload, type: 'refresh' },
      this.secret,
      { expiresIn: this.refreshTokenExpiresIn } as jwt.SignOptions
    );
  }

  // Verify access token (for backward compatibility, also works as generateToken)
  verifyToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as JWTPayload;
      // Don't allow refresh tokens to be used as access tokens
      if (decoded.type === 'refresh') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch {
      throw new Error('Invalid or expired token');
    }
  }

  // Verify refresh token
  verifyRefreshToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.secret) as JWTPayload;
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch {
      throw new Error('Invalid or expired refresh token');
    }
  }

  // Legacy method for backward compatibility
  generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return this.generateAccessToken(payload);
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

