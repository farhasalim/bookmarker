import { canSeePostNow } from '@bookmarker/gate';
import { nextSendableTime, postDigestEmail, replyEmail } from '@bookmarker/mail';
import { readPrefs, type NotificationPrefs } from '@bookmarker/shared';
import { roomUrl, type JobContext } from '../context.ts';

const BATCH = 500;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  userId: string;
  type: string;
  postId: string | null;
  roomId: string | null;
  payload: unknown;
};

function inAppOn(type: string, p: NotificationPrefs): boolean {
  if (type === 'post') return p.postsInApp;
  if (type === 'reply') return p.repliesInApp;
  return true;
}

/**
 * Step 1 (FR-12): deliver due notifications in-app.
 * The gate is re-run for every post/reply notification at THIS moment; anything
 * the reader can no longer see (moved back, left the club, post deleted) is dropped.
 */
export async function deliverDue(
  ctx: JobContext,
  now: Date,
): Promise<{ sent: number; dropped: number }> {
  const due: Row[] = await ctx.db.notification.findMany({
    where: { sentAt: null, droppedAt: null, sendAfter: { lte: now } },
    orderBy: { sendAfter: 'asc' },
    take: BATCH,
    select: { id: true, userId: true, type: true, postId: true, roomId: true, payload: true },
  });
  let sent = 0;
  let dropped = 0;
  for (const n of due) {
    const allowed = n.postId ? await canSeePostNow(ctx.db, n.userId, n.postId) : true;
    if (!allowed) {
      await ctx.db.notification.update({ where: { id: n.id }, data: { droppedAt: now } });
      dropped++;
      continue;
    }
    const user = await ctx.db.user.findUnique({
      where: { id: n.userId },
      select: { notificationPrefs: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      await ctx.db.notification.update({ where: { id: n.id }, data: { droppedAt: now } });
      dropped++;
      continue;
    }
    const prefs = readPrefs(user.notificationPrefs);
    // In-app switched off: mark processed but keep it out of the list. Email may still go.
    await ctx.db.notification.update({
      where: { id: n.id },
      data: { sentAt: now, ...(inAppOn(n.type, prefs) ? {} : { droppedAt: now }) },
    });
    if (inAppOn(n.type, prefs)) await ctx.ping(n.userId, n.id);
    sent++;
  }
  return { sent, dropped };
}

/**
 * Step 2: email what was delivered, for readers who opted in, outside quiet hours.
 * Post notifications become one digest per reader per book. The gate is checked
 * AGAIN right before emailing, and no email ever contains post text.
 */
export async function emailDelivered(ctx: JobContext, now: Date): Promise<number> {
  const rows = await ctx.db.notification.findMany({
    where: {
      type: { in: ['post', 'reply'] },
      sentAt: { not: null, gte: new Date(now.getTime() - EMAIL_WINDOW_MS) },
      emailedAt: null,
    },
    orderBy: { sentAt: 'asc' },
    take: BATCH,
    select: {
      id: true,
      userId: true,
      type: true,
      postId: true,
      roomId: true,
      payload: true,
      user: { select: { email: true, timezone: true, notificationPrefs: true, deletedAt: true } },
    },
  });
  const byUserRoom = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.userId}:${r.type}:${r.roomId}`;
    byUserRoom.set(k, [...(byUserRoom.get(k) ?? []), r]);
  }

  let emails = 0;
  for (const group of byUserRoom.values()) {
    const first = group[0]!;
    const { user } = first;
    if (user.deletedAt) continue;
    const prefs = readPrefs(user.notificationPrefs);
    const wants = first.type === 'post' ? prefs.postsEmail : prefs.repliesEmail;
    if (!wants) continue; // re-evaluated each tick for 24 h in case they switch it on
    if (nextSendableTime(now, user.timezone) > now) continue; // quiet hours: try again later

    const still = [];
    for (const n of group) {
      if (n.postId && (await canSeePostNow(ctx.db, n.userId, n.postId))) still.push(n);
    }
    const ids = group.map((n) => n.id);
    if (still.length > 0) {
      const url = roomUrl(ctx.appUrl, first.roomId ?? '');
      if (first.type === 'post') {
        const p0 = still[0]!.payload as { roomTitle?: string };
        await ctx.mailer.send(
          postDigestEmail(
            user.email,
            {
              bookTitle: p0.roomTitle ?? 'your book',
              roomUrl: url,
              items: still.map((n) => {
                const p = n.payload as { authorName?: string; position?: number };
                return { authorName: p.authorName ?? 'A friend', position: p.position ?? 0 };
              }),
            },
            { appUrl: ctx.appUrl },
          ),
        );
        emails++;
      } else {
        for (const n of still) {
          const p = n.payload as { replierName?: string; position?: number; roomTitle?: string };
          await ctx.mailer.send(
            replyEmail(
              user.email,
              {
                replierName: p.replierName ?? 'A friend',
                position: p.position ?? 0,
                bookTitle: p.roomTitle ?? 'your book',
                url,
              },
              { appUrl: ctx.appUrl },
            ),
          );
          emails++;
        }
      }
    }
    await ctx.db.notification.updateMany({ where: { id: { in: ids } }, data: { emailedAt: now } });
  }
  return emails;
}
