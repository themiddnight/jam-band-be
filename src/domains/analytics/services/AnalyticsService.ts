import { prisma } from "../../../config/prisma";
import { StartSessionInput } from "../validation/AnalyticsSchemas";

export async function startSession(input: StartSessionInput) {
  const joinedAt = input.joinedAt ? new Date(input.joinedAt) : new Date();
  
  // Find or create the room if externalRoomId is provided
  let roomId: string | undefined = undefined;
  if (input.externalRoomId) {
    const room = await prisma.room.upsert({
      where: { externalId: input.externalRoomId },
      create: {
        externalId: input.externalRoomId,
        ownerId: input.userId ?? null,
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
        firstSeen: joinedAt,
        lastSeen: joinedAt,
        totalSessions: 1,
        totalRoomsJoined: 1,
      },
      update: {
        username: input.username ?? null,
        lastSeen: joinedAt,
        totalSessions: { increment: 1 },
        totalRoomsJoined: { increment: 1 },
      },
    });
  }

  // Create the session
  const session = await prisma.roomSession.create({
    data: {
      anonymousId: input.anonymousId,
      externalRoomId: input.externalRoomId,
      role: input.role,
      instrumentUsed: input.instrumentUsed ?? null,
      usernameSnapshot: input.username ?? null,
      joinedAt,
      ...(input.userId && { userId: input.userId }),
      ...(roomId && { roomId }),
    },
    select: { id: true, joinedAt: true },
  });

  return { sessionId: session.id, joinedAt: session.joinedAt };
}

export async function endSession(input: { sessionId: string; leftAt?: string }) {
  const leftAt = input.leftAt ? new Date(input.leftAt) : new Date();
  
  const existing = await prisma.roomSession.findUnique({ 
    where: { id: input.sessionId } 
  });
  
  if (!existing) {
    return { notFound: true } as const;
  }
  
  if (existing.leftAt) {
    return { ok: true } as const; // idempotent
  }

  const duration = Math.max(0, Math.floor((leftAt.getTime() - existing.joinedAt.getTime()) / 1000));
  
  await prisma.roomSession.update({
    where: { id: input.sessionId },
    data: { leftAt, durationSeconds: duration },
  });
  
  return { ok: true } as const;
}

