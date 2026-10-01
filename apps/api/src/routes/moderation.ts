import { Router } from 'express';
import { CreateReport, Moderate } from '@bookmarker/shared';
import { fileReport, locatePost, openReports, resolveReportsFor, softDeletePost, type RoomAccess } from '@bookmarker/gate';
import type { Deps } from '../deps.ts';
import { me } from '../auth/sessions.ts';
import { notFound } from '../http/errors.ts';
import { requireHost, requireHostAccess, requireRoomAccess } from '../http/access.ts';
import { limit } from '../http/rate-limit.ts';
import { recordEvent } from '../realtime/bus.ts';

/** FR-19: report a post; hosts delete posts. (No "hide": decision #13.) */
export function moderationRoutes(d: Deps): Router {
  const r = Router();
  const writes = limit(d.limiter, 'writes', (req) => req.user?.id ?? req.ip ?? '');

  r.post('/reports', writes, async (req, res) => {
    const user = me(req);
    const { postId, reason } = CreateReport.parse(req.body);
    await d.db.$transaction(async (tx) => {
      const loc = await locatePost(tx, postId);
      if (!loc) throw notFound();
      const access = await requireRoomAccess(tx, user.id, loc.roomId);
      if (!(await fileReport(tx, access, postId, reason))) throw notFound();
    });
    res.status(201).json({ ok: true });
  });

  r.get('/clubs/:clubId/reports', async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    const reports = await d.db.$transaction(async (tx) => {
      await requireHost(tx, user.id, clubId);
      const rooms = await tx.room.findMany({ where: { clubId }, select: { id: true } });
      const byRoom = new Map<string, RoomAccess>();
      for (const room of rooms) byRoom.set(room.id, await requireRoomAccess(tx, user.id, room.id));
      return openReports(tx, byRoom);
    });
    res.json({ reports });
  });

  r.post('/moderation/posts/:postId', writes, async (req, res) => {
    const user = me(req);
    Moderate.parse(req.body);
    const postId = String(req.params.postId);
    const event = await d.db.$transaction(async (tx) => {
      const loc = await locatePost(tx, postId);
      if (!loc) throw notFound();
      const access = await requireRoomAccess(tx, user.id, loc.roomId);
      requireHostAccess(access);
      const del = await softDeletePost(tx, access, postId);
      await resolveReportsFor(tx, postId, user.id, d.now());
      return recordEvent(tx, { type: 'moderation', roomId: loc.roomId, postId, ...del });
    });
    await d.bus.publish(event);
    res.json({ ok: true });
  });

  return r;
}
