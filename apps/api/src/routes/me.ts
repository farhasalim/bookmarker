import { Router } from 'express';
import { UpdateMe, readPrefs } from '@bookmarker/shared';
import { ownContent, profileBooks } from '@bookmarker/gate';
import type { Deps } from '../deps.ts';
import { SESSION_COOKIE, endSession, me } from '../auth/sessions.ts';
import { notFound } from '../http/errors.ts';
import { limit } from '../http/rate-limit.ts';

export function meRoutes(d: Deps): Router {
  const r = Router();
  const writes = limit(d.limiter, 'writes', (req) => req.user?.id ?? req.ip ?? '');

  /** Home: who I am, my clubs, each with its current room and my bookmark. */
  r.get('/me', async (req, res) => {
    const user = me(req);
    const u = await d.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        timezone: true,
        starTotal: true,
        notificationPrefs: true,
        isAdmin: true,
        memberships: {
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            positionHidden: true,
            club: {
              select: {
                id: true,
                name: true,
                rooms: {
                  where: { status: 'current' },
                  select: {
                    id: true,
                    title: true,
                    author: true,
                    coverUrl: true,
                    chaptersConfirmedAt: true,
                    _count: { select: { chapters: { where: { kind: 'chapter' } } } },
                    bookmarks: {
                      where: { userId: user.id },
                      select: { position: true, finished: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      timezone: u.timezone,
      starTotal: u.starTotal,
      isAdmin: u.isAdmin,
      notificationPrefs: readPrefs(u.notificationPrefs),
      clubs: u.memberships.map((m) => ({
        id: m.club.id,
        name: m.club.name,
        role: m.role,
        positionHidden: m.positionHidden,
        currentRooms: m.club.rooms.map((room) => ({
          id: room.id,
          title: room.title,
          author: room.author,
          coverUrl: room.coverUrl,
          chaptersConfirmed: room.chaptersConfirmedAt !== null,
          chapterCount: room._count.chapters,
          position: room.bookmarks[0]?.position ?? 0,
          finished: room.bookmarks[0]?.finished ?? false,
        })),
      })),
    });
  });

  r.patch('/me', writes, async (req, res) => {
    const user = me(req);
    const input = UpdateMe.parse(req.body);
    const current = await d.db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    const prefs = input.notificationPrefs
      ? { ...readPrefs(current.notificationPrefs), ...input.notificationPrefs }
      : undefined;
    const u = await d.db.user.update({
      where: { id: user.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(prefs ? { notificationPrefs: prefs } : {}),
      },
      select: { name: true, timezone: true, notificationPrefs: true },
    });
    res.json({
      name: u.name,
      timezone: u.timezone,
      notificationPrefs: readPrefs(u.notificationPrefs),
    });
  });

  /* ---------------- privacy (SEC-11) ---------------- */

  r.get('/me/export', async (req, res) => {
    const user = me(req);
    const data = await d.db.$transaction(async (tx) => {
      const profile = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          name: true,
          timezone: true,
          createdAt: true,
          notificationPrefs: true,
          starTotal: true,
        },
      });
      const memberships = await tx.membership.findMany({
        where: { userId: user.id },
        select: {
          role: true,
          positionHidden: true,
          joinedAt: true,
          club: { select: { name: true } },
        },
      });
      const bookmarks = await tx.bookmark.findMany({
        where: { userId: user.id },
        select: {
          position: true,
          finished: true,
          movedAt: true,
          room: { select: { title: true } },
        },
      });
      const stars = await tx.starEvent.findMany({
        where: { userId: user.id },
        select: { reason: true, createdAt: true, room: { select: { title: true } } },
      });
      return {
        exportedAt: d.now().toISOString(),
        profile,
        memberships,
        bookmarks,
        stars,
        ...(await ownContent(tx, user.id)),
      };
    });
    res.setHeader('Content-Disposition', 'attachment; filename="bookmarker-export.json"');
    res.json(data);
  });

  /**
   * Delete my account: the person goes, their words stay as "Former member" so
   * club discussions keep making sense (SEC-11). Clubs never lose their last host.
   */
  r.delete('/me', writes, async (req, res) => {
    const user = me(req);
    await d.db.$transaction(async (tx) => {
      const hosted = await tx.membership.findMany({
        where: { userId: user.id, role: 'host' },
        select: { clubId: true },
      });
      for (const { clubId } of hosted) {
        const otherHosts = await tx.membership.count({
          where: { clubId, role: 'host', userId: { not: user.id } },
        });
        if (otherHosts > 0) continue;
        const heir = await tx.membership.findFirst({
          where: { clubId, userId: { not: user.id }, user: { deletedAt: null } },
          orderBy: { joinedAt: 'asc' },
        });
        if (heir) {
          await tx.membership.update({
            where: { clubId_userId: { clubId, userId: heir.userId } },
            data: { role: 'host' },
          });
        } else {
          await tx.club.delete({ where: { id: clubId } });
        }
      }
      await tx.membership.deleteMany({ where: { userId: user.id } });
      await tx.nudgeSchedule.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.authIdentity.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: 'Former member',
          email: `deleted-${user.id}@deleted.invalid`,
          avatarUrl: null,
          notificationPrefs: {},
          deletedAt: d.now(),
        },
      });
    });
    await endSession(d.db, res, req.cookies?.[SESSION_COOKIE], d.config.COOKIE_SECURE);
    res.status(204).end();
  });

  /* ---------------- profile (FR-18) ---------------- */

  r.get('/users/:userId/profile', async (req, res) => {
    const viewer = me(req);
    const userId = String(req.params.userId);
    const out = await d.db.$transaction(async (tx) => {
      const shared = await tx.membership.findMany({
        where: { userId, club: { memberships: { some: { userId: viewer.id } } } },
        select: { club: { select: { id: true, name: true } } },
      });
      if (userId !== viewer.id && shared.length === 0) throw notFound();
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          starTotal: true,
          createdAt: true,
          deletedAt: true,
        },
      });
      if (!u || u.deletedAt) throw notFound();
      const books = await profileBooks(tx, userId, viewer.id);
      return {
        id: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        readingSince: u.createdAt.getUTCFullYear(),
        starTotal: u.starTotal,
        clubs: shared.map((s) => s.club),
        booksFinished: books.length,
        reviewsWritten: books.filter((b) => b.review !== null).length,
        books,
      };
    });
    res.json(out);
  });

  return r;
}
