import { Router } from 'express';
import {
  CreateRoom,
  ReplaceChapters,
  SetBookmark,
  UpsertReview,
  limitsFor,
  readPrefs,
  reminderDue,
  withinLimit,
  type UnlockResult,
} from '@bookmarker/shared';
import {
  getMyReview,
  listRoomReviews,
  postsUnlockedBetween,
  unlockedRange,
  upsertReview,
  type Viewer,
} from '@bookmarker/gate';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import { me } from '../auth/sessions.ts';
import { HttpError } from '../http/errors.ts';
import { requireHost, requireHostAccess, requireRoomAccess } from '../http/access.ts';
import { limit } from '../http/rate-limit.ts';
import { recordEvent, type RoomEvent } from '../realtime/bus.ts';
import { buildRoomDTO, replaceChapters } from '../services/rooms.ts';
import { queueFinishedNotifications } from '../services/notify.ts';

export function roomRoutes(d: Deps): Router {
  const r = Router();
  const writes = limit(d.limiter, 'writes', (req) => req.user?.id ?? req.ip ?? '');

  r.get('/books/search', async (req, res) => {
    me(req);
    const q = z.string().trim().min(2).max(200).parse(req.query.q);
    res.json({ results: await d.books.search(q) });
  });

  /* ---------------- open a reading room (FR-4) ---------------- */

  r.post('/clubs/:clubId/rooms', writes, async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    const input = CreateRoom.parse(req.body);
    const now = d.now();
    const room = await d.db.$transaction(async (tx) => {
      await requireHost(tx, user.id, clubId);
      const club = await tx.club.findUniqueOrThrow({
        where: { id: clubId },
        select: { plan: true },
      });
      const current = await tx.room.count({ where: { clubId, status: 'current' } });
      if (!withinLimit(limitsFor(club.plan).maxCurrentRooms, current)) {
        throw new HttpError(
          409,
          'PLAN_LIMIT',
          'Finish or close the current book before opening another',
        );
      }
      const room = await tx.room.create({
        data: {
          clubId,
          title: input.title,
          author: input.author ?? null,
          coverUrl: input.coverUrl ?? null,
          isbn: input.isbn ?? null,
          openedAt: now,
          chapters: {
            create: [
              ...input.chapters.map((c, i) => ({ position: i + 1, title: c.title })),
              {
                position: input.chapters.length + 1,
                title: 'After the book',
                kind: 'after_book' as const,
              },
            ],
          },
        },
      });
      const members = await tx.membership.findMany({
        where: { clubId, user: { deletedAt: null } },
        select: { userId: true, user: { select: { notificationPrefs: true } } },
      });
      await tx.bookmark.createMany({
        data: members.map((m) => ({
          userId: m.userId,
          roomId: room.id,
          joinedAt: now,
          movedAt: now,
        })),
      });
      await tx.nudgeSchedule.createMany({
        data: members.map((m) => ({
          userId: m.userId,
          roomId: room.id,
          nextReminderAt: reminderDue(
            now,
            null,
            readPrefs(m.user.notificationPrefs).reminderEveryDays,
          ),
        })),
      });
      return room;
    });
    res.status(201).json({ id: room.id });
  });

  r.get('/rooms/:roomId', async (req, res) => {
    const user = me(req);
    const dto = await d.db.$transaction(async (tx) => {
      const access = await requireRoomAccess(tx, user.id, String(req.params.roomId));
      return buildRoomDTO(tx, access);
    });
    res.json(dto);
  });

  /* ---------------- chapters (FR-5 + decision #11) ---------------- */

  r.put('/rooms/:roomId/chapters', writes, async (req, res) => {
    const user = me(req);
    const roomId = String(req.params.roomId);
    const input = ReplaceChapters.parse(req.body);
    const now = d.now();
    const { dto, event } = await d.db.$transaction(async (tx) => {
      const access = await requireRoomAccess(tx, user.id, roomId);
      requireHostAccess(access);
      await replaceChapters(tx, roomId, input.chapters, input.confirm ?? false, now);
      const event = await recordEvent(tx, { type: 'chapters', roomId });
      const fresh = await requireRoomAccess(tx, user.id, roomId);
      return { dto: await buildRoomDTO(tx, fresh), event };
    });
    await d.bus.publish(event);
    res.json(dto);
  });

  r.post('/rooms/:roomId/close', writes, async (req, res) => {
    const user = me(req);
    const roomId = String(req.params.roomId);
    await d.db.$transaction(async (tx) => {
      const access = await requireRoomAccess(tx, user.id, roomId);
      requireHostAccess(access);
      await tx.room.update({ where: { id: roomId }, data: { status: 'done', closedAt: d.now() } });
      await tx.nudgeSchedule.deleteMany({ where: { roomId } });
    });
    res.json({ status: 'done' });
  });

  /* ---------------- the bookmark (FR-6, gate rules 6–7) ---------------- */

  r.put('/rooms/:roomId/bookmark', writes, async (req, res) => {
    const user = me(req);
    const roomId = String(req.params.roomId);
    const input = SetBookmark.parse(req.body);
    const now = d.now();

    const { result, events } = await d.db.$transaction(async (tx) => {
      const access = await requireRoomAccess(tx, user.id, roomId);
      if (!access.chaptersConfirmed) {
        throw new HttpError(
          409,
          'CHAPTERS_NOT_CONFIRMED',
          'The host is still setting up the chapters',
        );
      }
      const chapterCount = access.afterBookPosition - 1;
      if (input.position > chapterCount) {
        throw new HttpError(400, 'VALIDATION', `This book has ${chapterCount} chapters`);
      }
      const before = access.viewer;
      const after: Viewer = {
        ...before,
        position: input.finished ? chapterCount : input.position,
        finished: input.finished,
      };

      await tx.bookmark.upsert({
        where: { userId_roomId: { userId: user.id, roomId } },
        create: {
          userId: user.id,
          roomId,
          position: after.position,
          finished: after.finished,
          movedAt: now,
          joinedAt: now,
        },
        update: { position: after.position, finished: after.finished, movedAt: now },
      });

      if (after.finished) {
        await tx.nudgeSchedule.deleteMany({ where: { userId: user.id, roomId } });
      } else {
        const u = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { notificationPrefs: true },
        });
        const sched = await tx.nudgeSchedule.findUnique({
          where: { userId_roomId: { userId: user.id, roomId } },
        });
        const next = reminderDue(
          now,
          sched?.lastReminderAt ?? null,
          readPrefs(u.notificationPrefs).reminderEveryDays,
        );
        await tx.nudgeSchedule.upsert({
          where: { userId_roomId: { userId: user.id, roomId } },
          create: { userId: user.id, roomId, nextReminderAt: next },
          update: { nextReminderAt: next },
        });
      }

      const range = unlockedRange(before, after);
      const posts = range ? await postsUnlockedBetween(tx, after, range.above, range.through) : [];
      const events: RoomEvent[] = [];
      if (before.position !== after.position || before.finished !== after.finished) {
        events.push(
          await recordEvent(tx, {
            type: 'bookmark',
            roomId,
            userId: user.id,
            from: { position: before.position, finished: before.finished },
            to: { position: after.position, finished: after.finished },
          }),
        );
      }
      if (after.finished && !before.finished) {
        const room = await tx.room.findUniqueOrThrow({
          where: { id: roomId },
          select: { title: true },
        });
        await queueFinishedNotifications(
          tx,
          {
            userId: user.id,
            userName: user.name,
            roomId,
            clubId: access.clubId,
            roomTitle: room.title,
          },
          now,
        );
      }
      const result: UnlockResult = {
        from: before.position,
        to: after.position,
        finished: after.finished,
        posts,
      };
      return { result, events };
    });
    for (const e of events) await d.bus.publish(e);
    res.json(result);
  });

  /* ---------------- reviews (FR-15–17) ---------------- */

  r.get('/rooms/:roomId/reviews', async (req, res) => {
    const user = me(req);
    const reviews = await d.db.$transaction(async (tx) => {
      const { viewer } = await requireRoomAccess(tx, user.id, String(req.params.roomId));
      return listRoomReviews(tx, viewer);
    });
    res.json({ reviews });
  });

  r.get('/rooms/:roomId/reviews/me', async (req, res) => {
    const user = me(req);
    const review = await d.db.$transaction(async (tx) => {
      const { viewer } = await requireRoomAccess(tx, user.id, String(req.params.roomId));
      return getMyReview(tx, viewer);
    });
    res.json({ review });
  });

  r.put('/rooms/:roomId/reviews/me', writes, async (req, res) => {
    const user = me(req);
    const input = UpsertReview.parse(req.body);
    const out = await d.db.$transaction(async (tx) => {
      const { viewer } = await requireRoomAccess(tx, user.id, String(req.params.roomId));
      return upsertReview(tx, viewer, input, d.now());
    });
    res.json(out);
  });

  return r;
}
