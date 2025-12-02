import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { AuthService } from '../../domain/services/AuthService';

export const createGoogleStrategy = (authService: AuthService) => {
  const backendUrl = process.env.VITE_API_URL || process.env.BACKEND_URL || 'http://localhost:3001';
  return new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: `${backendUrl}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName || profile.name?.givenName || 'User';

        if (!email) {
          return done(new Error('No email provided by Google'), false);
        }

        const { user, accessToken: appAccessToken, refreshToken: appRefreshToken } = await authService.findOrCreateOAuthUser(
          'google',
          profile.id,
          email,
          name
        );

        // Attach tokens and providerId to user object for later use
        (user as any).accessToken = appAccessToken;
        (user as any).refreshToken = appRefreshToken;
        (user as any).providerId = profile.id;

        return done(null, user);
      } catch (error) {
        return done(error, false);
      }
    }
  );
};

