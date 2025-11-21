import { z } from "zod";

export const UserRole = z.enum(["ROOM_OWNER", "BAND_MEMBER", "AUDIENCE"]);

export const StartSessionSchema = z.object({
  anonymousId: z.string().uuid(),
  externalRoomId: z.string().min(1),
  role: UserRole,
  username: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
  instrumentUsed: z.string().optional(),
  joinedAt: z.string().datetime().optional(),
});

export const EndSessionSchema = z.object({
  sessionId: z.string().uuid(),
  leftAt: z.string().datetime().optional(),
});

export type StartSessionInput = z.infer<typeof StartSessionSchema>;
export type EndSessionInput = z.infer<typeof EndSessionSchema>;

