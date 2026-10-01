import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SeedResult } from '@bookmarker/db/seed';
import { agentFor, agents, db, freshSeed, makeDeps, sessionCookie } from './helpers.ts';

let t: ReturnType<typeof makeDeps>;
let s: SeedResult;
let a: Awaited<ReturnType<typeof agents>>;

beforeEach(async () => {
  s = await freshSeed();
  t = makeDeps();
  a = await agents(t.app, s);
});
afterAll(() => db.$disconnect());

const tokenOf = (url: string) => url.split('/join/')[1]!;

describe('clubs (FR-2)', () => {
  it('creates a club and makes the creator host', async () => {
    const res = await a.outsider.post('/clubs', { name: 'Poetry Circle' }).expect(201);
    const club = await a.outsider.get(`/clubs/${res.body.id}`).expect(200);
    expect(club.body.me.role).toBe('host');
    expect(club.body.members).toHaveLength(1);
  });

  it('enforces a 3–60 character name', async () => {
    await a.outsider.post('/clubs', { name: 'ab' }).expect(400);
    await a.outsider.post('/clubs', { name: 'x'.repeat(61) }).expect(400);
  });

  it('hides clubs from non-members with a 404', async () => {
    await a.outsider.get(`/clubs/${s.clubId}`).expect(404);
  });

  it('lets only hosts edit the club', async () => {
    await a.rahul.patch(`/clubs/${s.clubId}`, { name: 'Renamed' }).expect(403);
    await a.anu.patch(`/clubs/${s.clubId}`, { name: 'Renamed' }).expect(200);
  });
});

describe('invites (FR-3, AT-14)', () => {
  it('a valid link joins the club and opens a bookmark in the current room', async () => {
    const inv = await a.anu.post(`/clubs/${s.clubId}/invites`, {}).expect(201);
    const token = tokenOf(inv.body.url);
    await a.anon.get(`/invites/${token}`).expect(200, { club: { name: 'Thursday Readers' } });
    await a.outsider.post(`/invites/${token}/accept`).expect(201);
    const room = await a.outsider.get(`/rooms/${s.roomId}`).expect(200);
    expect(room.body.me).toMatchObject({ position: 0, finished: false, isHost: false });
    const nudge = await db.nudgeSchedule.findUnique({
      where: { userId_roomId: { userId: s.users.outsider, roomId: s.roomId } },
    });
    expect(nudge).not.toBeNull();
  });

  it('expired, revoked, used-up and unknown links give distinct errors', async () => {
    const expired = tokenOf(
      (await a.anu.post(`/clubs/${s.clubId}/invites`, { expiresInDays: 1 })).body.url,
    );
    t.clock.advance(2 * 24 * 3600 * 1000);
    expect((await a.outsider.post(`/invites/${expired}/accept`).expect(410)).body.error.code).toBe(
      'INVITE_EXPIRED',
    );

    const revoked = await a.anu.post(`/clubs/${s.clubId}/invites`, {});
    await a.anu.delete(`/invites/${revoked.body.id}`).expect(204);
    expect(
      (await a.outsider.post(`/invites/${tokenOf(revoked.body.url)}/accept`).expect(410)).body.error
        .code,
    ).toBe('INVITE_REVOKED');

    const once = tokenOf((await a.anu.post(`/clubs/${s.clubId}/invites`, { maxUses: 1 })).body.url);
    await a.outsider.post(`/invites/${once}/accept`).expect(201);
    const another = await db.user.create({ data: { email: 'late@example.test', name: 'Late' } });
    const late = agentFor(t.app, await sessionCookie(another.id));
    expect((await late.post(`/invites/${once}/accept`).expect(410)).body.error.code).toBe(
      'INVITE_USED_UP',
    );

    expect(
      (await a.outsider.post('/invites/not-a-real-token/accept').expect(404)).body.error.code,
    ).toBe('INVITE_INVALID');
  });

  it('only hosts create, list and revoke invites', async () => {
    await a.rahul.post(`/clubs/${s.clubId}/invites`, {}).expect(403);
    await a.rahul.get(`/clubs/${s.clubId}/invites`).expect(403);
    const inv = await a.anu.post(`/clubs/${s.clubId}/invites`, {}).expect(201);
    await a.rahul.delete(`/invites/${inv.body.id}`).expect(403);
    const list = await a.anu.get(`/clubs/${s.clubId}/invites`).expect(200);
    expect(list.body.invites).toHaveLength(1);
  });

  it('stores invite tokens hashed', async () => {
    const inv = await a.anu.post(`/clubs/${s.clubId}/invites`, {}).expect(201);
    const row = await db.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
    expect(row.tokenHash).not.toBe(tokenOf(inv.body.url));
  });

  it('accepting twice is harmless', async () => {
    const token = tokenOf((await a.anu.post(`/clubs/${s.clubId}/invites`, {})).body.url);
    await a.rahul
      .post(`/invites/${token}/accept`)
      .expect(200, { clubId: s.clubId, alreadyMember: true });
  });

  it('rate-limits invite creation (5 per hour per club)', async () => {
    for (let i = 0; i < 5; i++) await a.anu.post(`/clubs/${s.clubId}/invites`, {}).expect(201);
    await a.anu.post(`/clubs/${s.clubId}/invites`, {}).expect(429);
  });
});

describe('members (FR-19: ≥ 1 host)', () => {
  it('the last host cannot leave while others remain', async () => {
    const res = await a.anu.delete(`/clubs/${s.clubId}/members/${s.users.anu}`).expect(409);
    expect(res.body.error.code).toBe('LAST_HOST');
  });

  it('a host can promote someone, then leave', async () => {
    await a.anu.patch(`/clubs/${s.clubId}/members/${s.users.rahul}`, { role: 'host' }).expect(200);
    await a.anu.delete(`/clubs/${s.clubId}/members/${s.users.anu}`).expect(204);
    await a.anu.get(`/rooms/${s.roomId}`).expect(404);
  });

  it('cannot demote the only host', async () => {
    await a.anu.patch(`/clubs/${s.clubId}/members/${s.users.anu}`, { role: 'member' }).expect(409);
  });

  it('members can leave; only hosts remove others', async () => {
    await a.rahul.delete(`/clubs/${s.clubId}/members/${s.users.meera}`).expect(403);
    await a.anu.delete(`/clubs/${s.clubId}/members/${s.users.meera}`).expect(204);
    await a.meera.get(`/rooms/${s.roomId}`).expect(404);
    await a.rahul.delete(`/clubs/${s.clubId}/members/${s.users.rahul}`).expect(204);
  });

  it('hiding my position removes me from friends lists (FR-20)', async () => {
    let room = await a.meera.get(`/rooms/${s.roomId}`).expect(200);
    expect(room.body.friends.map((f: { name: string }) => f.name)).toContain('Rahul');
    await a.rahul.patch(`/clubs/${s.clubId}/me`, { positionHidden: true }).expect(200);
    room = await a.meera.get(`/rooms/${s.roomId}`).expect(200);
    expect(room.body.friends.map((f: { name: string }) => f.name)).not.toContain('Rahul');
  });
});
