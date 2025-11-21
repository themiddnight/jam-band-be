import { prisma } from "../../../config/prisma";
import { FeedbackInput } from "../validation/FeedbackSchemas";

export async function createFeedback(input: FeedbackInput & {
  userAgent?: string;
  ipAddress?: string | null;
}) {
  // Find or create the room if externalRoomId is provided
  let roomId: string | undefined = undefined;
  if (input.externalRoomId) {
    const room = await prisma.room.upsert({
      where: { externalId: input.externalRoomId },
      create: {
        externalId: input.externalRoomId,
      },
      update: {},
      select: { id: true },
    });
    roomId = room.id;
  }

  // Find or create the user if userId is provided
  if (input.userId) {
    await prisma.user.upsert({
      where: { id: input.userId },
      create: {
        id: input.userId,
        username: input.username ?? null,
        firstSeen: new Date(),
        lastSeen: new Date(),
      },
      update: {
        username: input.username ?? null,
        lastSeen: new Date(),
      },
    });
  }

  const feedback = await prisma.userFeedback.create({
    data: {
      anonymousId: input.anonymousId,
      category: input.category,
      experienceLevel: input.experienceLevel,
      rating: input.rating ?? null,
      message: input.message ?? null,
      usagePurposes: input.usagePurposes,
      externalRoomId: input.externalRoomId ?? null,
      roleUsed: input.roleUsed ?? null,
      usernameSnapshot: input.username ?? null,
      timezone: input.timezone ?? null,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      ...(input.userId && { userId: input.userId }),
      ...(roomId && { roomId }),
    },
    select: { id: true, submittedAt: true },
  });
  
  return { feedbackId: feedback.id, submittedAt: feedback.submittedAt };
}

export async function hasSubmitted(anonymousId: string): Promise<boolean> {
  const count = await prisma.userFeedback.count({ 
    where: { anonymousId } 
  });
  
  return count > 0;
}

