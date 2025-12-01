import { UserType as PrismaUserType } from '@prisma/client';
import { AuthUserModel, UserType } from '../../domain/models/User';
import { EmailVerificationModel } from '../../domain/models/EmailVerification';
import { PasswordResetModel } from '../../domain/models/PasswordReset';
import { prisma } from '../db/prisma';

export interface CreateUserData {
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: UserType;
}

export interface CreateEmailVerificationData {
  userId: string;
  token: string;
  expiresAt: Date;
}

export interface CreatePasswordResetData {
  userId: string;
  token: string;
  expiresAt: Date;
}

export interface CreateOAuthAccountData {
  userId: string;
  provider: string;
  providerId: string;
}

export class UserRepository {
  async findById(id: string): Promise<AuthUserModel | null> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    return user ? AuthUserModel.fromPrisma(user) : null;
  }

  async findByEmail(email: string): Promise<AuthUserModel | null> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    return user ? AuthUserModel.fromPrisma(user) : null;
  }

  async findByUsername(username: string): Promise<AuthUserModel | null> {
    const user = await prisma.user.findFirst({
      where: { username },
    });

    return user ? AuthUserModel.fromPrisma(user) : null;
  }

  async create(data: CreateUserData): Promise<AuthUserModel> {
    const user = await prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash: data.passwordHash,
        emailVerified: data.emailVerified,
        userType: data.userType as PrismaUserType,
      },
    });

    return AuthUserModel.fromPrisma(user);
  }

  async updateEmailVerified(userId: string, emailVerified: boolean): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async updateUsername(userId: string, username: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { username },
    });
  }

  async createEmailVerification(data: CreateEmailVerificationData): Promise<EmailVerificationModel> {
    const verification = await prisma.emailVerification.create({
      data,
    });

    return EmailVerificationModel.fromPrisma(verification);
  }

  async findEmailVerificationByToken(token: string): Promise<EmailVerificationModel | null> {
    const verification = await prisma.emailVerification.findUnique({
      where: { token },
    });

    return verification ? EmailVerificationModel.fromPrisma(verification) : null;
  }

  async deleteEmailVerification(id: string): Promise<void> {
    await prisma.emailVerification.delete({
      where: { id },
    });
  }

  async deleteEmailVerificationsByUserId(userId: string): Promise<void> {
    await prisma.emailVerification.deleteMany({
      where: { userId },
    });
  }

  async createPasswordReset(data: CreatePasswordResetData): Promise<PasswordResetModel> {
    const reset = await prisma.passwordReset.create({
      data,
    });

    return PasswordResetModel.fromPrisma(reset);
  }

  async findPasswordResetByToken(token: string): Promise<PasswordResetModel | null> {
    const reset = await prisma.passwordReset.findUnique({
      where: { token },
    });

    return reset ? PasswordResetModel.fromPrisma(reset) : null;
  }

  async markPasswordResetAsUsed(id: string): Promise<void> {
    await prisma.passwordReset.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async deletePasswordResetsByUserId(userId: string): Promise<void> {
    await prisma.passwordReset.deleteMany({
      where: { userId },
    });
  }

  async createOAuthAccount(data: CreateOAuthAccountData): Promise<void> {
    await prisma.oAuthAccount.create({
      data,
    });
  }

  async findOAuthAccount(provider: string, providerId: string): Promise<{ userId: string } | null> {
    const account = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerId: {
          provider,
          providerId,
        },
      },
    });

    return account ? { userId: account.userId } : null;
  }
}

