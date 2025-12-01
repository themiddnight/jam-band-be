import { Router, type Router as RouterType } from 'express';
import passport from 'passport';
import { AuthController } from '../domains/auth/infrastructure/controllers/AuthController';
import { authenticateToken } from '../domains/auth/infrastructure/middleware/authMiddleware';
import { createLocalStrategy } from '../domains/auth/infrastructure/strategies/localStrategy';
import { createGoogleStrategy } from '../domains/auth/infrastructure/strategies/googleStrategy';
import { AuthService } from '../domains/auth/domain/services/AuthService';
import { UserRepository } from '../domains/auth/infrastructure/repositories/UserRepository';
import { config } from '../config/environment';

const router: RouterType = Router();
const authController = new AuthController();

// Initialize Passport strategies
const userRepository = new UserRepository();
const authService = new AuthService(userRepository);

passport.use('local', createLocalStrategy(authService));
passport.use('google', createGoogleStrategy(authService));

// Serialize/Deserialize user for sessions (if needed)
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await userRepository.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Register
router.post('/register', authController.register);

// Login
router.post('/login', passport.authenticate('local', { session: false }), (req, res) => {
  const user = req.user as any;
  if (!user) {
    res.status(401).json({ error: 'Login failed' });
    return;
  }

  // Generate token
  const { tokenService } = require('../domains/auth/domain/services/TokenService');
  const token = tokenService.generateToken({
    userId: user.id,
    email: user.email,
    userType: user.userType,
  });

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
});

// Verify email
router.get('/verify-email/:token', authController.verifyEmail);

// Resend verification
// @ts-expect-error - Type compatibility issue with Express middleware
router.post('/resend-verification', authenticateToken, authController.resendVerification);

// Forgot password
router.post('/forgot-password', authController.forgotPassword);

// Reset password
router.post('/reset-password', authController.resetPassword);

// Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${config.cors.frontendUrl}/login?error=oauth_failed` }),
  async (req, res) => {
    try {
      const user = req.user as any;
      if (!user) {
        res.redirect(`${config.cors.frontendUrl}/login?error=oauth_failed`);
        return;
      }

      // Generate token for the user
      const { tokenService } = require('../domains/auth/domain/services/TokenService');
      const token = tokenService.generateToken({
        userId: user.id,
        email: user.email,
        userType: user.userType,
      });

      // Redirect to frontend with token
      res.redirect(`${config.cors.frontendUrl}/auth/callback?token=${token}`);
    } catch {
      res.redirect(`${config.cors.frontendUrl}/login?error=oauth_failed`);
    }
  }
);

// Get current user
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/me', authenticateToken, authController.getCurrentUser);

// Logout
router.post('/logout', authController.logout);

export default router;

