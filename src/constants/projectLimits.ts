/**
 * Project limits configuration per user type
 * This allows easy adjustment for premium features in the future
 */

import { UserType } from '../domains/auth/domain/models/User';

/**
 * Project limits per user type
 * - GUEST: Cannot save projects
 * - REGISTERED: Free tier limit (default: 2)
 * - PREMIUM: Unlimited projects
 */
export const PROJECT_LIMITS: Record<UserType, number> = {
  [UserType.GUEST]: 0,
  [UserType.REGISTERED]: 2,
  [UserType.PREMIUM]: Infinity,
};

// Re-export UserType for convenience
export { UserType };

/**
 * Get the project limit for a specific user type
 */
export function getProjectLimit(userType: UserType | string): number {
  // Handle string values from Prisma
  if (typeof userType === 'string') {
    const normalizedType = userType.toUpperCase() as UserType;
    return PROJECT_LIMITS[normalizedType] ?? PROJECT_LIMITS[UserType.REGISTERED];
  }
  return PROJECT_LIMITS[userType] ?? PROJECT_LIMITS[UserType.REGISTERED];
}

/**
 * Check if a user has reached their project limit
 */
export function isProjectLimitReached(
  currentProjectCount: number,
  userType: UserType | string
): boolean {
  const limit = getProjectLimit(userType);
  if (limit === Infinity) {
    return false; // Unlimited
  }
  return currentProjectCount >= limit;
}

/**
 * Get the default project limit message
 */
export function getProjectLimitMessage(userType: UserType | string): string {
  const limit = getProjectLimit(userType);
  if (limit === Infinity) {
    return "Unlimited projects";
  }
  if (limit === 0) {
    return "Guests cannot save projects";
  }
  return `You can save up to ${limit} project${limit > 1 ? "s" : ""}`;
}

