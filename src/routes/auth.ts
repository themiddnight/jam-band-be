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

// Login - use AuthController which handles refresh tokens
router.post('/login', authController.login);

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

      // Tokens are already attached to user object by GoogleStrategy
      const accessToken = (user as any).accessToken;
      const refreshToken = (user as any).refreshToken;

      if (!accessToken || !refreshToken) {
        res.redirect(`${config.cors.frontendUrl}/login?error=oauth_failed`);
        return;
      }

      // Redirect to frontend with tokens
      res.redirect(`${config.cors.frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect(`${config.cors.frontendUrl}/login?error=oauth_failed`);
    }
  }
);

// Get current user
// @ts-expect-error - Type compatibility issue with Express middleware
router.get('/me', authenticateToken, authController.getCurrentUser);

// Update username
// @ts-expect-error - Type compatibility issue with Express middleware
router.put('/username', authenticateToken, authController.updateUsername);

// Refresh token
router.post('/refresh-token', authController.refreshToken);

// Logout
// @ts-expect-error - Type compatibility issue with Express middleware
router.post('/logout', authenticateToken, authController.logout);

export default router;

