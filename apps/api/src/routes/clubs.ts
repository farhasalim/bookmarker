import { Router } from 'express';
import {
  CreateClub,
  CreateInvite,
  UpdateClub,
  UpdateMembership,
  limitsFor,
  reminderDue,
  withinLimit,
} from '@bookmarker/shared';
import { z } from 'zod';
import type { Deps } from '../deps.ts';
import { me } from '../auth/sessions.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { requireHost, requireMember } from '../http/access.ts';
import { limit } from '../http/rate-limit.ts';
import { hashToken, newToken } from '../lib/tokens.ts';

const DAY = 24 * 60 * 60 * 1000;

export function clubRoutes(d: Deps): Router {
  const r = Router();
  const writes = limit(d.limiter, 'writes', (req) => req.user?.id ?? req.ip ?? '');
  const invitesPerClub = limit(d.limiter, 'invites', (req) => String(req.params.clubId));

  /* ---------------- clubs (FR-2) ---------------- */

  r.post('/clubs', writes, async (req, res) => {
    const user = me(req);
    const input = CreateClub.parse(req.body);
    const club = await d.db.club.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        createdById: user.id,
        memberships: { create: { userId: user.id, role: 'host' } },
      },
    });
    res.status(201).json({ id: club.id, name: club.name });
  });

  r.get('/clubs/:clubId', async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    const membership = await requireMember(d.db, user.id, clubId);
    const club = await d.db.club.findUniqueOrThrow({
      where: { id: clubId },
      include: {
        rooms: {
          orderBy: { openedAt: 'desc' },
          select: {
            id: true,
            title: true,
            author: true,
            coverUrl: true,
            status: true,
            openedAt: true,
          },
        },
        memberships: {
          where: { user: { deletedAt: null } },
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            joinedAt: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });
    res.json({
      id: club.id,
      name: club.name,
      description: club.description,
      plan: club.plan,
      limits: limitsFor(club.plan),
      me: { role: membership.role, positionHidden: membership.positionHidden },
      rooms: club.rooms,
      members: club.memberships.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt })),
    });
  });

  r.patch('/clubs/:clubId', writes, async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    await requireHost(d.db, user.id, clubId);
    const input = UpdateClub.parse(req.body);
    const club = await d.db.club.update({ where: { id: clubId }, data: input });
    res.json({ id: club.id, name: club.name, description: club.description });
  });

  /** Hide or show my position in this club (FR-20). */
  r.patch('/clubs/:clubId/me', writes, async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    await requireMember(d.db, user.id, clubId);
    const { positionHidden } = UpdateMembership.parse(req.body);
    await d.db.membership.update({
      where: { clubId_userId: { clubId, userId: user.id } },
      data: { positionHidden },
    });
    res.json({ positionHidden });
  });

  /* ---------------- invites (FR-3, AT-14) ---------------- */

  r.post('/clubs/:clubId/invites', writes, invitesPerClub, async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    await requireHost(d.db, user.id, clubId);
    const input = CreateInvite.parse(req.body ?? {});
    const token = newToken();
    const invite = await d.db.invite.create({
      data: {
        clubId,
        tokenHash: hashToken(token),
        expiresAt: new Date(d.now().getTime() + input.expiresInDays * DAY),
        maxUses: input.maxUses ?? null,
        createdById: user.id,
      },
    });
    // The token is shown once, here. Only its hash is stored.
    res.status(201).json({
      id: invite.id,
      url: `${d.config.APP_URL}/join/${token}`,
      expiresAt: invite.expiresAt,
      maxUses: invite.maxUses,
    });
  });

  r.get('/clubs/:clubId/invites', async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    await requireHost(d.db, user.id, clubId);
    const invites = await d.db.invite.findMany({
      where: { clubId, revokedAt: null, expiresAt: { gt: d.now() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, maxUses: true, uses: true, createdAt: true },
    });
    res.json({ invites });
  });

  r.delete('/invites/:id', writes, async (req, res) => {
    const user = me(req);
    const invite = await d.db.invite.findUnique({ where: { id: String(req.params.id) } });
    if (!invite) throw notFound();
    await requireHost(d.db, user.id, invite.clubId);
    await d.db.invite.update({ where: { id: invite.id }, data: { revokedAt: d.now() } });
    res.status(204).end();
  });

  async function checkInvite(token: string) {
    const invite = await d.db.invite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { club: { select: { id: true, name: true, plan: true } } },
    });
    if (!invite) throw new HttpError(404, 'INVITE_INVALID', 'This invite link is not valid');
    if (invite.revokedAt)
      throw new HttpError(410, 'INVITE_REVOKED', 'This invite link was turned off by the host');
    if (invite.expiresAt <= d.now())
      throw new HttpError(410, 'INVITE_EXPIRED', 'This invite link has expired');
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      throw new HttpError(410, 'INVITE_USED_UP', 'This invite link has been used up');
    }
    return invite;
  }

  /** Preview for the join page: club name only. Works signed out. */
  r.get('/invites/:token', async (req, res) => {
    const invite = await checkInvite(String(req.params.token));
    res.json({ club: { name: invite.club.name } });
  });

  r.post('/invites/:token/accept', writes, async (req, res) => {
    const user = me(req);
    const invite = await checkInvite(String(req.params.token));
    const clubId = invite.club.id;
    const already = await d.db.membership.findUnique({
      where: { clubId_userId: { clubId, userId: user.id } },
    });
    if (already) return res.json({ clubId, alreadyMember: true });

    const now = d.now();
    await d.db.$transaction(async (tx) => {
      const count = await tx.membership.count({ where: { clubId } });
      if (!withinLimit(limitsFor(invite.club.plan).maxMembers, count)) {
        throw new HttpError(409, 'PLAN_LIMIT', 'This club is full');
      }
      // Count the use atomically; a concurrent accept can't push it past max_uses.
      const used = await tx.invite.updateMany({
        where: {
          id: invite.id,
          revokedAt: null,
          ...(invite.maxUses !== null ? { uses: { lt: invite.maxUses } } : {}),
        },
        data: { uses: { increment: 1 } },
      });
      if (used.count !== 1)
        throw new HttpError(410, 'INVITE_USED_UP', 'This invite link has been used up');
      await tx.membership.create({
        data: { clubId, userId: user.id, role: 'member', joinedAt: now },
      });
      const rooms = await tx.room.findMany({
        where: { clubId, status: 'current' },
        select: { id: true },
      });
      for (const room of rooms) {
        await tx.bookmark.upsert({
          where: { userId_roomId: { userId: user.id, roomId: room.id } },
          create: { userId: user.id, roomId: room.id, position: 0, joinedAt: now, movedAt: now },
          update: {},
        });
        await tx.nudgeSchedule.upsert({
          where: { userId_roomId: { userId: user.id, roomId: room.id } },
          create: { userId: user.id, roomId: room.id, nextReminderAt: reminderDue(now, null, 3) },
          update: {},
        });
      }
    });
    res.status(201).json({ clubId, alreadyMember: false });
  });

  /* ---------------- members (FR-19: remove; leave; ≥ 1 host) ---------------- */

  r.delete('/clubs/:clubId/members/:userId', writes, async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    const targetId = String(req.params.userId);
    const actor = await requireMember(d.db, user.id, clubId);
    if (targetId !== user.id && actor.role !== 'host') {
      throw new HttpError(403, 'FORBIDDEN', 'Only a host can remove members');
    }
    await d.db.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: { clubId_userId: { clubId, userId: targetId } },
      });
      if (!target) throw notFound();
      if (target.role === 'host') {
        const hosts = await tx.membership.count({ where: { clubId, role: 'host' } });
        const members = await tx.membership.count({ where: { clubId } });
        if (hosts <= 1 && members > 1) {
          throw new HttpError(409, 'LAST_HOST', 'Make someone else a host before leaving');
        }
      }
      await tx.membership.delete({ where: { clubId_userId: { clubId, userId: targetId } } });
      await tx.nudgeSchedule.deleteMany({ where: { userId: targetId, room: { clubId } } });
      const left = await tx.membership.count({ where: { clubId } });
      if (left === 0) await tx.club.delete({ where: { id: clubId } });
    });
    res.status(204).end();
  });

  r.patch('/clubs/:clubId/members/:userId', writes, async (req, res) => {
    const user = me(req);
    const clubId = String(req.params.clubId);
    const targetId = String(req.params.userId);
    await requireHost(d.db, user.id, clubId);
    const { role } = z.object({ role: z.enum(['host', 'member']) }).parse(req.body);
    await d.db.$transaction(async (tx) => {
      await requireMember(tx, targetId, clubId);
      if (role === 'member') {
        const hosts = await tx.membership.count({
          where: { clubId, role: 'host', userId: { not: targetId } },
        });
        if (hosts === 0) throw new HttpError(409, 'LAST_HOST', 'A club needs at least one host');
      }
      await tx.membership.update({
        where: { clubId_userId: { clubId, userId: targetId } },
        data: { role },
      });
    });
    res.json({ role });
  });

  return r;
}
