import { Request, Response } from 'express';
import { AuthService } from '../../domain/services/AuthService';
import { UserRepository } from '../repositories/UserRepository';
// import { tokenService } from '../../domain/services/TokenService';
import { AuthRequest } from '../middleware/authMiddleware';

export class AuthController {
  private authService: AuthService;

  constructor() {
    const userRepository = new UserRepository();
    this.authService = new AuthService(userRepository);
  }

  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password, username } = req.body;

      if (!email || !password || !username) {
        res.status(400).json({ error: 'Email, password, and username are required' });
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }

      // Validate password strength
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      const { user } = await this.authService.register({
        email,
        password,
        username,
      });

      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account.',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Registration failed' });
    }
  };

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const { user, token } = await this.authService.login({ email, password });

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
        },
        token,
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message || 'Login failed' });
    }
  };

  verifyEmail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;

      if (!token) {
        res.status(400).json({ error: 'Verification token is required' });
        return;
      }

      const user = await this.authService.verifyEmail(token);

      res.json({
        message: 'Email verified successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
        },
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Email verification failed' });
    }
  };

  resendVerification = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      await this.authService.resendVerificationEmail(req.user.id);

      res.json({ message: 'Verification email sent' });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to resend verification email' });
    }
  };

  forgotPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }

      await this.authService.requestPasswordReset(email);

      // Always return success to prevent email enumeration
      res.json({ message: 'If an account exists with this email, a password reset link has been sent' });
    } catch {
      // Still return success to prevent email enumeration
      res.json({ message: 'If an account exists with this email, a password reset link has been sent' });
    }
  };

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        res.status(400).json({ error: 'Token and new password are required' });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      await this.authService.resetPassword(token, newPassword);

      res.json({ message: 'Password reset successful' });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Password reset failed' });
    }
  };

  getCurrentUser = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const userRepository = new UserRepository();
      const user = await userRepository.findById(req.user.id);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          userType: user.userType,
          emailVerified: user.emailVerified,
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to get user' });
    }
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    // JWT is stateless, so logout is handled client-side by removing the token
    res.json({ message: 'Logged out successfully' });
  };
}

