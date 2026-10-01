import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import { me } from '../auth/sessions.ts';
import { notFound } from '../http/errors.ts';

/**
 * In-app notifications ("Letters"). Only rows the worker has delivered (sent_at set
 * after its send-time gate check) are listed. Payloads hold names, chapter numbers
 * and counts, never post text.
 */
export function notificationRoutes(d: Deps): Router {
  const r = Router();

  r.get('/notifications', async (req, res) => {
    const user = me(req);
    const rows = await d.db.notification.findMany({
      where: { userId: user.id, sentAt: { not: null }, droppedAt: null },
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: { id: true, type: true, payload: true, roomId: true, chapterId: true, postId: true, sentAt: true, readAt: true },
    });
    const unread = await d.db.notification.count({
      where: { userId: user.id, sentAt: { not: null }, droppedAt: null, readAt: null },
    });
    res.json({
      unread,
      notifications: rows.map((n) => ({ ...n, sentAt: n.sentAt?.toISOString(), read: n.readAt !== null })),
    });
  });

  r.patch('/notifications/:id', async (req, res) => {
    const user = me(req);
    z.object({ read: z.literal(true) }).parse(req.body);
    const updated = await d.db.notification.updateMany({
      where: { id: String(req.params.id), userId: user.id },
      data: { readAt: d.now() },
    });
    if (updated.count === 0) throw notFound();
    res.json({ ok: true });
  });

  r.post('/notifications/read-all', async (req, res) => {
    const user = me(req);
    await d.db.notification.updateMany({
      where: { userId: user.id, readAt: null, sentAt: { not: null } },
      data: { readAt: d.now() },
    });
    res.json({ ok: true });
  });

  return r;
}
