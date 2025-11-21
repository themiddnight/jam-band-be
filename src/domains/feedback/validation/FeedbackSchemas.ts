import { z } from "zod";
import { UserRole } from "../../analytics/validation/AnalyticsSchemas";

export const FeedbackCategory = z.enum(["BUG_REPORT", "FEATURE_REQUEST", "GENERAL_FEEDBACK"]);
export const ExperienceLevel = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]);

export const FeedbackSchema = z.object({
  anonymousId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  externalRoomId: z.string().optional(),
  roleUsed: UserRole.optional(),
  username: z.string().optional(),
  category: FeedbackCategory,
  experienceLevel: ExperienceLevel,
  rating: z.number().int().min(1).max(5).optional(),
  message: z.string().max(5000).optional(),
  usagePurposes: z.array(z.string()).min(1),
  timezone: z.string().optional(),
});

export const HasSubmittedQuerySchema = z.object({
  anonymousId: z.string().uuid(),
});

export type FeedbackInput = z.infer<typeof FeedbackSchema>;
export type HasSubmittedQuery = z.infer<typeof HasSubmittedQuerySchema>;

