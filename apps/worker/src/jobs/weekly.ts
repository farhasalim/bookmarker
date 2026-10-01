import { localHour, localWeekday, weeklyEmail } from '@bookmarker/mail';
import { isoWeekKey, readPrefs } from '@bookmarker/shared';
import { roomUrl, type JobContext } from '../context.ts';

/**
 * FR-14 / AT-10: Sunday 10:00 in each reader's time zone, where friends in each
 * active room have reached. Chapter numbers only; readers who hide their position
 * are left out. Runs every 15 minutes; a dedupe key makes it once per reader,
 * room and week however often it runs.
 */
export async function runWeekly(ctx: JobContext, now: Date): Promise<number> {
  const readers = await ctx.db.bookmark.findMany({
    where: {
      user: { deletedAt: null },
      room: { status: 'current', chaptersConfirmedAt: { not: null } },
    },
    select: {
      userId: true,
      roomId: true,
      position: true,
      finished: true,
      user: { select: { email: true, timezone: true, notificationPrefs: true } },
      room: { select: { title: true, clubId: true } },
    },
  });

  let sent = 0;
  for (const r of readers) {
    const tz = r.user.timezone;
    if (localWeekday(now, tz) !== 'Sun' || localHour(now, tz) !== 10) continue;
    const isMember = await ctx.db.membership.findUnique({
      where: { clubId_userId: { clubId: r.room.clubId, userId: r.userId } },
    });
    if (!isMember) continue;

    const dedupeKey = `weekly:${r.userId}:${r.roomId}:${isoWeekKey(now)}`;
    const exists = await ctx.db.notification.findUnique({ where: { dedupeKey } });
    if (exists) continue;

    const friends = await ctx.db.bookmark.findMany({
      where: {
        roomId: r.roomId,
        userId: { not: r.userId },
        user: {
          deletedAt: null,
          memberships: { some: { clubId: r.room.clubId, positionHidden: false } },
        },
      },
      select: { position: true, finished: true, user: { select: { name: true } } },
      orderBy: { position: 'desc' },
    });
    const list = friends.map((f) => ({
      name: f.user.name,
      position: f.position,
      finished: f.finished,
    }));
    const prefs = readPrefs(r.user.notificationPrefs);

    const n = await ctx.db.notification.create({
      data: {
        userId: r.userId,
        type: 'weekly',
        roomId: r.roomId,
        dedupeKey,
        sendAfter: now,
        sentAt: now,
        ...(prefs.weeklyInApp ? {} : { droppedAt: now }),
        payload: {
          roomTitle: r.room.title,
          you: { position: r.position, finished: r.finished },
          friends: list,
        },
      },
    });
    if (prefs.weeklyInApp) await ctx.ping(r.userId, n.id);
    if (prefs.weeklyEmail) {
      await ctx.mailer.send(
        weeklyEmail(
          r.user.email,
          {
            bookTitle: r.room.title,
            you: { position: r.position, finished: r.finished },
            friends: list,
            roomUrl: roomUrl(ctx.appUrl, r.roomId),
          },
          { appUrl: ctx.appUrl },
        ),
      );
      await ctx.db.notification.update({ where: { id: n.id }, data: { emailedAt: now } });
    }
    sent++;
  }
  return sent;
}
