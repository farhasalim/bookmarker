import { waitingCountAt } from '@bookmarker/gate';
import { nextSendableTime, reminderEmail } from '@bookmarker/mail';
import { readPrefs, reminderDue } from '@bookmarker/shared';
import { roomUrl, type JobContext } from '../context.ts';

const DAY = 24 * 60 * 60 * 1000;

/**
 * FR-13 / AT-9: a reading reminder every 3 days (or the reader's cadence) until
 * they finish, skipped when they moved their bookmark since the last one. It says
 * how many thoughts wait in the next chapter: a count from the gate, never text.
 */
export async function runReminders(ctx: JobContext, now: Date): Promise<number> {
  const due = await ctx.db.nudgeSchedule.findMany({
    where: { nextReminderAt: { lte: now } },
    take: 500,
    include: {
      user: { select: { email: true, timezone: true, notificationPrefs: true, deletedAt: true } },
      room: {
        select: {
          id: true,
          title: true,
          clubId: true,
          status: true,
          chaptersConfirmedAt: true,
          chapters: { where: { kind: 'chapter' }, select: { id: true, position: true } },
        },
      },
    },
  });

  let sent = 0;
  for (const row of due) {
    const key = { userId_roomId: { userId: row.userId, roomId: row.roomId } };
    const bookmark = await ctx.db.bookmark.findUnique({ where: key });
    const member = await ctx.db.membership.findUnique({
      where: { clubId_userId: { clubId: row.room.clubId, userId: row.userId } },
    });
    if (
      !bookmark ||
      bookmark.finished ||
      !member ||
      row.user.deletedAt ||
      row.room.status !== 'current'
    ) {
      await ctx.db.nudgeSchedule.delete({ where: key });
      continue;
    }
    const prefs = readPrefs(row.user.notificationPrefs);
    const dueAt = reminderDue(bookmark.movedAt, row.lastReminderAt, prefs.reminderEveryDays);
    if (dueAt > now || !row.room.chaptersConfirmedAt) {
      // They moved since the last reminder (or the host is still setting up): skip.
      await ctx.db.nudgeSchedule.update({
        where: key,
        data: { nextReminderAt: dueAt > now ? dueAt : new Date(now.getTime() + DAY) },
      });
      continue;
    }
    const sendable = nextSendableTime(now, row.user.timezone);
    if (sendable > now) {
      await ctx.db.nudgeSchedule.update({ where: key, data: { nextReminderAt: sendable } });
      continue; // quiet hours
    }

    const nextPosition = Math.min(bookmark.position + 1, row.room.chapters.length);
    const nextChapter = row.room.chapters.find((c) => c.position === nextPosition);
    const viewer = {
      userId: row.userId,
      roomId: row.roomId,
      position: bookmark.position,
      finished: false,
    };
    const waiting = nextChapter ? await waitingCountAt(ctx.db, viewer, nextChapter.id) : 0;
    const days = Math.max(1, Math.floor((now.getTime() - bookmark.movedAt.getTime()) / DAY));

    if (prefs.remindersInApp) {
      const n = await ctx.db.notification.create({
        data: {
          userId: row.userId,
          type: 'reminder',
          roomId: row.roomId,
          sendAfter: now,
          sentAt: now,
          payload: { roomTitle: row.room.title, nextPosition, waiting, days },
        },
      });
      await ctx.ping(row.userId, n.id);
    }
    if (prefs.remindersEmail) {
      await ctx.mailer.send(
        reminderEmail(
          row.user.email,
          {
            bookTitle: row.room.title,
            nextPosition,
            waiting,
            days,
            roomUrl: roomUrl(ctx.appUrl, row.roomId),
          },
          { appUrl: ctx.appUrl },
        ),
      );
    }
    await ctx.db.nudgeSchedule.update({
      where: key,
      data: {
        lastReminderAt: now,
        nextReminderAt: new Date(now.getTime() + prefs.reminderEveryDays * DAY),
      },
    });
    sent++;
  }
  return sent;
}
