/**
 * AT-1 leak sweep, email and in-app side. Simulates the worst case: a bug queued a
 * notification about EVERY post for EVERY reader. The worker's send-time gate
 * check must still keep everything above each reader's bookmark out of their
 * inbox and their in-app list.
 */
import { afterAll, expect, it } from 'vitest';
import { pino } from 'pino';
import { createDb } from '@bookmarker/db';
import { seed } from '@bookmarker/db/seed';
import { resetDb } from '@bookmarker/db/testing';
import { MemoryMailer } from '@bookmarker/mail';
import { deliverDue, emailDelivered } from '../src/jobs/deliver.ts';
import { runReminders } from '../src/jobs/reminders.ts';
import { runWeekly } from '../src/jobs/weekly.ts';

const db = createDb();
afterAll(() => db.$disconnect());

it('AT-1: no email or in-app notification reaches a reader about anything above their bookmark', async () => {
  await resetDb(db);
  const T0 = new Date('2026-10-01T06:00:00Z');
  const s = await seed(db, T0);
  const readers = [
    { id: s.users.meera, email: 'meera@example.test', reach: 3 },
    { id: s.users.rahul, email: 'rahul@example.test', reach: 10 },
    { id: s.users.anu, email: 'anu@example.test', reach: Number.POSITIVE_INFINITY },
  ];
  for (const r of readers) {
    await db.user.update({
      where: { id: r.id },
      data: { notificationPrefs: { postsEmail: true } },
    });
    await db.nudgeSchedule.create({ data: { userId: r.id, roomId: s.roomId, nextReminderAt: T0 } });
  }
  await db.notification.createMany({
    data: readers.flatMap((r) =>
      s.posts
        .filter((p) => p.authorId !== r.id)
        .map((p) => ({
          userId: r.id,
          type: 'post',
          postId: p.id,
          roomId: s.roomId,
          sendAfter: T0,
          payload: {
            authorName: 'Someone',
            position: p.position,
            roomTitle: 'Pride and Prejudice',
          },
        })),
    ),
  });

  const mailer = new MemoryMailer();
  const ctx = {
    db,
    mailer,
    logger: pino({ level: 'silent' }),
    appUrl: 'https://x.test',
    ping: async () => {},
  };
  await deliverDue(ctx, T0);
  await emailDelivered(ctx, T0);
  await runReminders(ctx, T0);
  await runWeekly(ctx, new Date('2026-10-04T04:30:00Z'));

  for (const r of readers) {
    // In-app: every delivered post notification is at or below the reader's bookmark.
    const listed = await db.notification.findMany({
      where: { userId: r.id, type: 'post', sentAt: { not: null }, droppedAt: null },
      select: { payload: true },
    });
    for (const n of listed)
      expect((n.payload as { position: number }).position).toBeLessThanOrEqual(r.reach);

    // Email: no chapter mentioned in a post digest is above the bookmark; no content at all.
    for (const m of mailer.to(r.email)) {
      const all = m.subject + m.text + m.html;
      expect(all).not.toMatch(/SPOILER|Reply at|on chapter \d+ /);
      if (m.subject.includes('new thought')) {
        for (const [, ch] of m.text.matchAll(/at chapter (\d+)\./g)) {
          expect(Number(ch)).toBeLessThanOrEqual(r.reach);
        }
      }
    }
  }
  // The send-time check really did drop things (it isn't passing by accident).
  expect(
    await db.notification.count({ where: { droppedAt: { not: null }, type: 'post' } }),
  ).toBeGreaterThan(5);
});
