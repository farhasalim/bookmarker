import type { Tx } from '@bookmarker/db';
import type { Viewer } from '@bookmarker/gate';

/** Post notifications go out in 30-minute batches (FR-12). */
export function nextBatchBoundary(now: Date): Date {
  const HALF_HOUR = 30 * 60 * 1000;
  return new Date(Math.ceil((now.getTime() + 1) / HALF_HOUR) * HALF_HOUR);
}

/**
 * Queue "new post" notifications for the post's audience AS OF NOW (FR-12). The
 * audience comes from gate.postAudience, and the worker re-checks each row with the
 * gate again at send time. Readers who reach the chapter later get nothing: they
 * find the post waiting (PRD rule 3, AT-6).
 *
 * Payload holds names and numbers only, never post text.
 */
export async function queuePostNotifications(
  tx: Tx,
  input: {
    postId: string;
    roomId: string;
    chapterId: string;
    position: number;
    authorName: string;
    roomTitle: string;
  },
  audience: Viewer[],
  now: Date,
): Promise<number> {
  if (audience.length === 0) return 0;
  const sendAfter = nextBatchBoundary(now);
  const res = await tx.notification.createMany({
    data: audience.map((v) => ({
      userId: v.userId,
      type: 'post',
      roomId: input.roomId,
      chapterId: input.chapterId,
      postId: input.postId,
      sendAfter,
      payload: {
        authorName: input.authorName,
        position: input.position,
        roomTitle: input.roomTitle,
      },
    })),
  });
  return res.count;
}

export async function queueReplyNotification(
  tx: Tx,
  input: {
    postAuthorId: string;
    replierId: string;
    replierName: string;
    postId: string;
    roomId: string;
    position: number;
    roomTitle: string;
  },
  now: Date,
): Promise<void> {
  if (input.postAuthorId === input.replierId) return;
  await tx.notification.create({
    data: {
      userId: input.postAuthorId,
      type: 'reply',
      roomId: input.roomId,
      postId: input.postId,
      sendAfter: now,
      payload: {
        replierName: input.replierName,
        position: input.position,
        roomTitle: input.roomTitle,
      },
    },
  });
}

/** "Anu finished the book": in-app only, once, no rating (PRD Notifications table). */
export async function queueFinishedNotifications(
  tx: Tx,
  input: { userId: string; userName: string; roomId: string; clubId: string; roomTitle: string },
  now: Date,
): Promise<void> {
  // Readers who hide their position don't announce finishing either (FR-20).
  const finisher = await tx.membership.findUnique({
    where: { clubId_userId: { clubId: input.clubId, userId: input.userId } },
    select: { positionHidden: true },
  });
  if (!finisher || finisher.positionHidden) return;
  const members = await tx.membership.findMany({
    where: { clubId: input.clubId, userId: { not: input.userId }, user: { deletedAt: null } },
    select: { userId: true },
  });
  if (members.length === 0) return;
  await tx.notification.createMany({
    data: members.map((m) => ({
      userId: m.userId,
      type: 'friend_finished',
      roomId: input.roomId,
      sendAfter: now,
      dedupeKey: `finished:${input.roomId}:${input.userId}:${m.userId}`,
      payload: { friendName: input.userName, roomTitle: input.roomTitle },
    })),
    skipDuplicates: true,
  });
}
