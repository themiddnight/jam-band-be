import bcrypt from 'bcrypt';
import { AuthUserModel, UserType } from '../models/User';
// import { EmailVerificationModel } from '../models/EmailVerification';
// import { PasswordResetModel } from '../models/PasswordReset';
import { tokenService } from './TokenService';
import { emailService } from '../../infrastructure/services/EmailService';
import { UserRepository } from '../../infrastructure/repositories/UserRepository';

export interface RegisterData {
  email: string;
  password: string;
  username: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export class AuthService {
  constructor(
    private userRepository: UserRepository
  ) {}

  async register(data: RegisterData): Promise<{ user: AuthUserModel; verificationToken: string }> {
    // Check if email already exists
    const existingUser = await this.userRepository.findByEmail(data.email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    // Check if username already exists
    if (data.username) {
      const existingUsername = await this.userRepository.findByUsername(data.username);
      if (existingUsername) {
        throw new Error('Username already taken');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Create user
    const user = await this.userRepository.create({
      email: data.email,
      username: data.username,
      passwordHash,
      emailVerified: false,
      userType: UserType.REGISTERED,
    });

    // Generate verification token
    const verificationToken = tokenService.generateEmailVerificationToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_HOURS || '24'));

    // Save verification token
    await this.userRepository.createEmailVerification({
      userId: user.id,
      token: verificationToken,
      expiresAt,
    });

    // Send verification email
    await emailService.sendVerificationEmail(data.email, verificationToken);

    return { user, verificationToken };
  }

  async login(data: LoginData): Promise<{ user: AuthUserModel; accessToken: string; refreshToken: string }> {
    const user = await this.userRepository.findByEmail(data.email);
    if (!user) {
      console.log(`[AuthService] Login failed: User not found for email: ${data.email}`);
      throw new Error('Invalid email or password');
    }
    
    if (!user.passwordHash) {
      console.log(`[AuthService] Login failed: User ${user.id} has no password hash`);
      throw new Error('Invalid email or password');
    }

    const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValidPassword) {
      console.log(`[AuthService] Login failed: Invalid password for user ${user.id}`);
      throw new Error('Invalid email or password');
    }

    // Generate tokens
    const accessToken = tokenService.generateAccessToken({
      userId: user.id,
      email: user.email,
      userType: user.userType,
    });

    const refreshToken = tokenService.generateRefreshToken({
      userId: user.id,
      email: user.email,
      userType: user.userType,
    });

    // Save refresh token to database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
    await this.userRepository.createRefreshToken({
      userId: user.id,
      token: refreshToken,
      expiresAt,
    });

    return { user, accessToken, refreshToken };
  }

  async verifyEmail(token: string): Promise<AuthUserModel> {
    // Find verification record
    const verification = await this.userRepository.findEmailVerificationByToken(token);
    if (!verification) {
      throw new Error('Invalid verification token');
    }

    if (verification.isExpired()) {
      throw new Error('Verification token has expired');
    }

    // Get user
    const user = await this.userRepository.findById(verification.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Mark email as verified
    await this.userRepository.updateEmailVerified(user.id, true);

    // Delete verification record
    await this.userRepository.deleteEmailVerification(verification.id);

    return user;
  }

  async resendVerificationEmail(userId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user || !user.email) {
      throw new Error('User not found or no email');
    }

    if (user.emailVerified) {
      throw new Error('Email already verified');
    }

    // Generate new verification token
    const verificationToken = tokenService.generateEmailVerificationToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(process.env.EMAIL_VERIFICATION_EXPIRES_HOURS || '24'));

    // Delete old verification tokens
    await this.userRepository.deleteEmailVerificationsByUserId(userId);

    // Save new verification token
    await this.userRepository.createEmailVerification({
      userId: user.id,
      token: verificationToken,
      expiresAt,
    });

    // Send verification email
    await emailService.sendVerificationEmail(user.email, verificationToken);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.email) {
      // Don't reveal if email exists
      return;
    }

    // Generate reset token
    const resetToken = tokenService.generatePasswordResetToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + parseInt(process.env.PASSWORD_RESET_EXPIRES_HOURS || '1'));

    // Delete old reset tokens
    await this.userRepository.deletePasswordResetsByUserId(user.id);

    // Save reset token
    await this.userRepository.createPasswordReset({
      userId: user.id,
      token: resetToken,
      expiresAt,
    });

    // Send reset email
    await emailService.sendPasswordResetEmail(user.email, resetToken);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // Find reset record
    const reset = await this.userRepository.findPasswordResetByToken(token);
    if (!reset) {
      throw new Error('Invalid reset token');
    }

    if (!reset.isValid()) {
      throw new Error('Reset token has expired or already used');
    }

    // Get user
    const user = await this.userRepository.findById(reset.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await this.userRepository.updatePassword(user.id, passwordHash);

    // Mark reset as used
    await this.userRepository.markPasswordResetAsUsed(reset.id);

    // Delete all reset tokens for this user
    await this.userRepository.deletePasswordResetsByUserId(user.id);
  }

  async findOrCreateOAuthUser(provider: string, providerId: string, email: string, name: string): Promise<{ user: AuthUserModel; accessToken: string; refreshToken: string }> {
    // Check if OAuth account exists
    const oauthAccount = await this.userRepository.findOAuthAccount(provider, providerId);
    
    if (oauthAccount) {
      const user = await this.userRepository.findById(oauthAccount.userId);
      if (!user) {
        throw new Error('User not found');
      }

      const accessToken = tokenService.generateAccessToken({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });

      const refreshToken = tokenService.generateRefreshToken({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });

      // Save refresh token to database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
      await this.userRepository.createRefreshToken({
        userId: user.id,
        token: refreshToken,
        expiresAt,
      });

      return { user, accessToken, refreshToken };
    }

    // Check if user with email exists
    let user = await this.userRepository.findByEmail(email);
    
    if (user) {
      // Link OAuth account to existing user
      await this.userRepository.createOAuthAccount({
        userId: user.id,
        provider,
        providerId,
      });

      const accessToken = tokenService.generateAccessToken({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });

      const refreshToken = tokenService.generateRefreshToken({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });

      // Save refresh token to database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
      await this.userRepository.createRefreshToken({
        userId: user.id,
        token: refreshToken,
        expiresAt,
      });

      return { user, accessToken, refreshToken };
    }

    // Create new user
    user = await this.userRepository.create({
      email,
      username: name,
      passwordHash: null,
      emailVerified: true, // OAuth emails are pre-verified
      userType: UserType.REGISTERED,
    });

    // Create OAuth account
    await this.userRepository.createOAuthAccount({
      userId: user.id,
      provider,
      providerId,
    });

    const accessToken = tokenService.generateAccessToken({
      userId: user.id,
      email: user.email,
      userType: user.userType,
    });

    const refreshToken = tokenService.generateRefreshToken({
      userId: user.id,
      email: user.email,
      userType: user.userType,
    });

    // Save refresh token to database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
    await this.userRepository.createRefreshToken({
      userId: user.id,
      token: refreshToken,
      expiresAt,
    });

    return { user, accessToken, refreshToken };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify refresh token
    const payload = tokenService.verifyRefreshToken(refreshToken);

    // Check if token exists in database and is valid
    const tokenRecord = await this.userRepository.findRefreshTokenByToken(refreshToken);
    if (!tokenRecord) {
      throw new Error('Refresh token not found');
    }

    if (tokenRecord.revokedAt) {
      throw new Error('Refresh token has been revoked');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new Error('Refresh token has expired');
    }

    // Get user
    const user = await this.userRepository.findById(payload.userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Generate new tokens
    const newAccessToken = tokenService.generateAccessToken({
      userId: user.id,
      email: user.email,
      userType: user.userType,
    });

    // Rotate refresh token (more secure)
    const newRefreshToken = tokenService.generateRefreshToken({
      userId: user.id,
      email: user.email,
      userType: user.userType,
    });

    // Revoke old refresh token and save new one
    await this.userRepository.revokeRefreshToken(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await this.userRepository.createRefreshToken({
      userId: user.id,
      token: newRefreshToken,
      expiresAt,
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async updateUsername(userId: string, newUsername: string): Promise<AuthUserModel> {
    // Validate username
    if (!newUsername || newUsername.trim().length === 0) {
      throw new Error('Username cannot be empty');
    }

    const trimmedUsername = newUsername.trim();

    if (trimmedUsername.length < 3 || trimmedUsername.length > 30) {
      throw new Error('Username must be between 3 and 30 characters');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
      throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
    }

    // Check if username is already taken by another user
    const existingUser = await this.userRepository.findByUsername(trimmedUsername);
    if (existingUser && existingUser.id !== userId) {
      throw new Error('Username already taken');
    }

    // Update username
    await this.userRepository.updateUsername(userId, trimmedUsername);

    // Get updated user
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }
}

