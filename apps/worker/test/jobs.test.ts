import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { createDb } from '@bookmarker/db';
import { seed, type SeedResult } from '@bookmarker/db/seed';
import { resetDb } from '@bookmarker/db/testing';
import { MemoryMailer } from '@bookmarker/mail';
import type { JobContext } from '../src/context.ts';
import { deliverDue, emailDelivered } from '../src/jobs/deliver.ts';
import { runReminders } from '../src/jobs/reminders.ts';
import { runWeekly } from '../src/jobs/weekly.ts';

const db = createDb();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// Thursday 1 Oct 2026, 11:30 IST (all seeded readers are in Asia/Kolkata).
const T0 = new Date('2026-10-01T06:00:00Z');

let s: SeedResult;
let mailer: MemoryMailer;
let pings: Array<{ userId: string; id: string }>;
let ctx: JobContext;

beforeEach(async () => {
  await resetDb(db);
  s = await seed(db, T0);
  mailer = new MemoryMailer();
  pings = [];
  ctx = {
    db,
    mailer,
    logger: pino({ level: 'silent' }),
    appUrl: 'https://bookmarker.test',
    ping: async (userId, id) => void pings.push({ userId, id }),
  };
  // Email is off by default (in-app only). Most tests here check what the emails
  // say, so every reader opts in; "defaults" at the bottom checks the default.
  await db.user.updateMany({ data: { notificationPrefs: ALL_EMAIL } });
});
afterAll(() => db.$disconnect());

const ALL_EMAIL = { postsEmail: true, repliesEmail: true, remindersEmail: true, weeklyEmail: true };

const email = (u: keyof SeedResult['users']) => `${u}@example.test`;
const postAt = (p: number, author: string) =>
  s.posts.find((x) => x.position === p && x.authorId === author)!.id;

async function queuePost(userId: string, postId: string, position: number, sendAfter = T0) {
  return db.notification.create({
    data: {
      userId,
      type: 'post',
      postId,
      roomId: s.roomId,
      sendAfter,
      payload: { authorName: 'Rahul', position, roomTitle: 'Pride and Prejudice' },
    },
  });
}

describe('post notifications: gate re-checked at send time (FR-12, AT-6)', () => {
  it('delivers to a reader who can see the post, in-app and by email when opted in', async () => {
    await db.user.update({
      where: { id: s.users.anu },
      data: { notificationPrefs: { postsEmail: true } },
    });
    const n = await queuePost(s.users.anu, postAt(10, s.users.rahul), 10);
    expect(await deliverDue(ctx, T0)).toEqual({ sent: 1, dropped: 0 });
    expect(pings).toEqual([{ userId: s.users.anu, id: n.id }]);
    expect(await emailDelivered(ctx, T0)).toBe(1);
    expect(mailer.to(email('anu'))[0]!.subject).toBe('1 new thought in Pride and Prejudice');
    expect(mailer.to(email('anu'))[0]!.text).toContain('Rahul left a thought at chapter 10.');
  });

  it('drops it if the reader moved back below the chapter before the batch went out', async () => {
    await queuePost(s.users.rahul, postAt(8, s.users.anu), 8);
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.rahul, roomId: s.roomId } },
      data: { position: 7 },
    });
    expect(await deliverDue(ctx, T0)).toEqual({ sent: 0, dropped: 1 });
    expect(pings).toEqual([]);
  });

  it('drops it if the post was deleted', async () => {
    const id = postAt(2, s.users.anu);
    await queuePost(s.users.meera, id, 2);
    await db.post.update({ where: { id }, data: { deletedAt: T0 } });
    expect(await deliverDue(ctx, T0)).toEqual({ sent: 0, dropped: 1 });
  });

  it('waits for its batch time', async () => {
    await queuePost(
      s.users.anu,
      postAt(10, s.users.rahul),
      10,
      new Date(T0.getTime() + 30 * 60 * 1000),
    );
    expect(await deliverDue(ctx, T0)).toEqual({ sent: 0, dropped: 0 });
  });

  it('holds emails during quiet hours (22:00–07:00 local) and sends at 07:00', async () => {
    await db.user.update({
      where: { id: s.users.anu },
      data: { notificationPrefs: { postsEmail: true } },
    });
    const night = new Date('2026-10-01T17:00:00Z'); // 22:30 IST
    await queuePost(s.users.anu, postAt(10, s.users.rahul), 10, night);
    await deliverDue(ctx, night);
    expect(await emailDelivered(ctx, night)).toBe(0);
    expect(await emailDelivered(ctx, new Date('2026-10-02T01:30:00Z'))).toBe(1); // 07:00 IST
  });

  it('respects channel switches (FR-20)', async () => {
    await db.user.update({
      where: { id: s.users.anu },
      data: { notificationPrefs: { postsInApp: false, postsEmail: false } },
    });
    const n = await queuePost(s.users.anu, postAt(10, s.users.rahul), 10);
    await deliverDue(ctx, T0);
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.droppedAt).not.toBeNull(); // not listed in-app
    expect(await emailDelivered(ctx, T0)).toBe(0);
    expect(pings).toEqual([]);
  });

  it('a reply notifies the author even though they wrote the post', async () => {
    await db.notification.create({
      data: {
        userId: s.users.anu,
        type: 'reply',
        postId: postAt(2, s.users.anu),
        roomId: s.roomId,
        sendAfter: T0,
        payload: { replierName: 'Meera', position: 2, roomTitle: 'Pride and Prejudice' },
      },
    });
    expect(await deliverDue(ctx, T0)).toEqual({ sent: 1, dropped: 0 });
    await emailDelivered(ctx, T0);
    expect(mailer.to(email('anu'))[0]!.subject).toBe(
      'Meera replied to your thought in Pride and Prejudice',
    );
  });
});

describe('3-day reading reminder (FR-13, AT-9)', () => {
  beforeEach(async () => {
    // All readers last moved at T0 - 30 days (seed). Put Meera's schedule due now.
    await db.nudgeSchedule.create({
      data: { userId: s.users.meera, roomId: s.roomId, nextReminderAt: T0 },
    });
  });

  it('an idle reader gets one reminder with a waiting count and no post text', async () => {
    expect(await runReminders(ctx, T0)).toBe(1);
    const m = mailer.to(email('meera'));
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe('Chapter 4 is waiting for you');
    expect(m[0]!.text).toContain('1 thought is already there');
    expect(m[0]!.text + m[0]!.html).not.toMatch(/SPOILER|Anu on chapter/);
    const inApp = await db.notification.findFirstOrThrow({
      where: { userId: s.users.meera, type: 'reminder' },
    });
    expect(inApp.payload).toMatchObject({ nextPosition: 4, waiting: 1 });
    // Not again until 3 days later.
    expect(await runReminders(ctx, new Date(T0.getTime() + 2 * DAY))).toBe(0);
    expect(await runReminders(ctx, new Date(T0.getTime() + 3 * DAY))).toBe(1);
  });

  it('a reader who moved their bookmark since the last reminder gets none', async () => {
    await runReminders(ctx, T0);
    mailer.clear();
    const moved = new Date(T0.getTime() + 1 * DAY);
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.meera, roomId: s.roomId } },
      data: { position: 4, movedAt: moved },
    });
    expect(await runReminders(ctx, new Date(T0.getTime() + 3 * DAY))).toBe(0);
    expect(mailer.sent).toEqual([]);
    // ...and gets the next one 3 days after that move.
    expect(await runReminders(ctx, new Date(moved.getTime() + 3 * DAY))).toBe(1);
  });

  it('stops for Finished readers and people who left', async () => {
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.meera, roomId: s.roomId } },
      data: { finished: true },
    });
    expect(await runReminders(ctx, T0)).toBe(0);
    expect(await db.nudgeSchedule.count()).toBe(0);
  });

  it('waits until 07:00 when due during quiet hours', async () => {
    const night = new Date('2026-10-01T18:00:00Z'); // 23:30 IST
    await db.nudgeSchedule.update({
      where: { userId_roomId: { userId: s.users.meera, roomId: s.roomId } },
      data: { nextReminderAt: night },
    });
    expect(await runReminders(ctx, night)).toBe(0);
    const row = await db.nudgeSchedule.findFirstOrThrow();
    expect(row.nextReminderAt.toISOString()).toBe('2026-10-02T01:30:00.000Z');
  });
});

describe('weekly friends update (FR-14, AT-10)', () => {
  const SUNDAY_10_IST = new Date('2026-10-04T04:30:00Z');

  it('Sunday 10:00 local: each reader gets friends’ chapter numbers; hidden friends are left out', async () => {
    await db.membership.update({
      where: { clubId_userId: { clubId: s.clubId, userId: s.users.rahul } },
      data: { positionHidden: true },
    });
    expect(await runWeekly(ctx, SUNDAY_10_IST)).toBe(3);
    const m = mailer.to(email('meera'))[0]!;
    expect(m.subject).toBe('Where everyone is in Pride and Prejudice');
    expect(m.text).toContain('You: chapter 3.');
    expect(m.text).toContain('Anu: finished');
    expect(m.text).not.toContain('Rahul');
    // Only chapter numbers, never content.
    expect(m.text + m.html).not.toMatch(/SPOILER|on chapter \d+ /);
  });

  it('runs once per week however often the job fires', async () => {
    await runWeekly(ctx, SUNDAY_10_IST);
    expect(await runWeekly(ctx, new Date(SUNDAY_10_IST.getTime() + 15 * 60 * 1000))).toBe(0);
  });

  it('does nothing outside Sunday 10:00 local', async () => {
    expect(await runWeekly(ctx, new Date('2026-10-04T06:00:00Z'))).toBe(0); // 11:30 IST
    expect(await runWeekly(ctx, T0)).toBe(0); // Thursday
  });

  it('follows each reader’s own time zone', async () => {
    await db.user.update({ where: { id: s.users.meera }, data: { timezone: 'Europe/London' } });
    expect(await runWeekly(ctx, SUNDAY_10_IST)).toBe(2); // not Meera yet
    expect(await runWeekly(ctx, new Date('2026-10-04T09:00:00Z'))).toBe(1); // 10:00 BST
  });
});

describe('defaults: notifications in-app only, email only for sign-in', () => {
  beforeEach(async () => {
    await db.user.updateMany({ data: { notificationPrefs: {} } });
  });

  it('posts, replies, reminders and the weekly update arrive in the app and send no email', async () => {
    await queuePost(s.users.anu, postAt(10, s.users.rahul), 10);
    await db.notification.create({
      data: {
        userId: s.users.anu,
        type: 'reply',
        postId: postAt(2, s.users.anu),
        roomId: s.roomId,
        sendAfter: T0,
        payload: { replierName: 'Meera', position: 2, roomTitle: 'Pride and Prejudice' },
      },
    });
    expect(await deliverDue(ctx, T0)).toEqual({ sent: 2, dropped: 0 });
    await emailDelivered(ctx, T0);

    await db.nudgeSchedule.create({
      data: { userId: s.users.meera, roomId: s.roomId, nextReminderAt: T0 },
    });
    expect(await runReminders(ctx, T0)).toBe(1);
    await runWeekly(ctx, new Date('2026-10-04T04:30:00Z')); // Sunday 10:00 IST

    expect(mailer.sent).toEqual([]);
    const inApp = await db.notification.findMany({ select: { type: true } });
    expect(new Set(inApp.map((n) => n.type))).toEqual(
      new Set(['post', 'reply', 'reminder', 'weekly']),
    );
  });
});
