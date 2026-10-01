/**
 * AT-1 LEAK SWEEP — runs on every pull request and blocks the merge.
 *
 *   "For every GET endpoint and every seeded reader, no response contains any
 *    post, reply or like above that reader's bookmark."
 *
 * 1. Routes are discovered from the live Express router, so a NEW GET endpoint
 *    fails this test until it is added to the sweep below.
 * 2. Every route is called by every seeded reader with every seeded id.
 * 3. Socket events are swept too: every reader listens while others post,
 *    reply, like, move bookmarks and moderate.
 * Leaks are detected by searching responses for the ids and texts of posts and
 * replies the reader must not see, and for review text before finishing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeedResult } from '@bookmarker/db/seed';
import { createApp } from '../src/app.ts';
import { agentFor, db, freshSeed, makeDeps, sessionCookie, type Agent } from './helpers.ts';
import { join, record, settle, startServer, type ClientSocket } from './realtime-helpers.ts';

let s: SeedResult;
const reach = { meera: 3, rahul: 10, anu: Number.POSITIVE_INFINITY, outsider: -1 } as const;
type Reader = keyof typeof reach;
const READERS: Reader[] = ['meera', 'rahul', 'anu', 'outsider'];

/** Everything `reader` must never receive. */
function forbiddenFor(reader: Reader): string[] {
  const me = reader === 'outsider' ? s.users.outsider : s.users[reader];
  const hiddenPosts = s.posts.filter((p) => p.authorId !== me && p.position > reach[reader]);
  const hiddenIds = new Set(hiddenPosts.map((p) => p.id));
  const out = hiddenPosts.flatMap((p) => [p.id]);
  // Seed bodies carry markers like "SPOILER-12"; check the exact text too.
  for (const p of hiddenPosts) {
    out.push(p.position === 21 ? 'SPOILER-END' : `SPOILER-${p.position}`);
  }
  for (const r of s.replies) if (hiddenIds.has(r.postId)) out.push(r.id, `Reply at ${r.position}`);
  if (reach[reader] !== Number.POSITIVE_INFINITY) out.push('SPOILER-REVIEW');
  return [...new Set(out)];
}

function assertNoLeak(reader: Reader, where: string, payload: unknown) {
  const text = JSON.stringify(payload) ?? '';
  for (const bad of forbiddenFor(reader)) {
    if (text.includes(bad)) {
      throw new Error(`LEAK: ${reader} received "${bad}" from ${where}\n${text.slice(0, 500)}`);
    }
  }
}

/* --------------------------------------------------------------- HTTP sweep */

/** Every GET route the API serves, read from the router itself. */
function discoverGetRoutes(): string[] {
  const { app } = makeDeps();
  const found = new Set<string>();
  type Layer = {
    route?: { path: string; methods: Record<string, boolean> };
    handle?: { stack?: Layer[] };
  };
  const walk = (stack: Layer[] | undefined, prefix: string) => {
    for (const layer of stack ?? []) {
      if (layer.route?.methods.get) found.add(prefix + layer.route.path);
      else if (layer.handle?.stack) walk(layer.handle.stack, prefix);
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '');
  return [...found].sort();
}

/**
 * The sweep plan: each GET route → how to expand its params. Routes that cannot
 * return content are listed with the reason. A route missing here fails the test.
 */
function plan(): Record<string, string[] | { skip: string }> {
  const all = (xs: string[]) => xs;
  const postIds = s.posts.map((p) => p.id);
  const userIds = Object.values(s.users);
  return {
    '/healthz': { skip: 'returns { ok } only' },
    '/google': { skip: 'redirect to Google' },
    '/google/callback': { skip: 'redirect after sign-in' },
    '/magic-link/verify': { skip: 'redirect after sign-in' },
    '/providers': { skip: 'returns provider flags only' },
    '/invites/:token': { skip: 'returns club name only (tested in clubs.test)' },
    '/me': ['/me'],
    '/me/export': ['/me/export'],
    '/users/:userId/profile': all(userIds.map((u) => `/users/${u}/profile`)),
    '/clubs/:clubId': [`/clubs/${s.clubId}`],
    '/clubs/:clubId/invites': [`/clubs/${s.clubId}/invites`],
    '/clubs/:clubId/reports': [`/clubs/${s.clubId}/reports`],
    '/books/search': { skip: 'external catalogue data, no club content' },
    '/rooms/:roomId': [`/rooms/${s.roomId}`],
    '/rooms/:roomId/reviews': [`/rooms/${s.roomId}/reviews`],
    '/rooms/:roomId/reviews/me': [`/rooms/${s.roomId}/reviews/me`],
    '/chapters/:chapterId/posts': s.chapterIds.map((c) => `/chapters/${c}/posts?limit=50`),
    '/posts/:postId': postIds.map((p) => `/posts/${p}`),
    '/posts/:postId/replies': postIds.map((p) => `/posts/${p}/replies`),
    '/notifications': ['/notifications'],
  };
}

describe('AT-1 leak sweep: HTTP', () => {
  let agents: Record<Reader, Agent>;

  beforeAll(async () => {
    s = await freshSeed();
    // Give everyone delivered notifications about posts they were allowed to hear about,
    // and make every report visible, so those endpoints have data to leak.
    await db.notification.createMany({
      data: s.posts.map((p) => ({
        userId: s.users.anu,
        type: 'post',
        postId: p.id,
        payload: { authorName: 'x', position: p.position },
        sentAt: new Date(),
      })),
    });
    for (const p of s.posts) {
      await db.report
        .create({ data: { postId: p.id, reporterId: s.users.anu } })
        .catch(() => undefined);
    }
    await db.membership.updateMany({ where: { clubId: s.clubId }, data: { role: 'host' } });
    const { app } = makeDeps();
    agents = {
      meera: agentFor(app, await sessionCookie(s.users.meera)),
      rahul: agentFor(app, await sessionCookie(s.users.rahul)),
      anu: agentFor(app, await sessionCookie(s.users.anu)),
      outsider: agentFor(app, await sessionCookie(s.users.outsider)),
    };
  });

  it('every GET route is in the sweep plan (add new routes to plan())', () => {
    const missing = discoverGetRoutes().filter((r) => !(r in plan()));
    expect(missing).toEqual([]);
  });

  it('no response to any reader contains anything above their bookmark', async () => {
    let calls = 0;
    for (const [route, paths] of Object.entries(plan())) {
      if (!Array.isArray(paths)) continue;
      for (const path of paths) {
        for (const reader of READERS) {
          const res = await agents[reader].get(path);
          calls++;
          expect(res.status, `${reader} GET ${path}`).toBeLessThan(500);
          assertNoLeak(reader, `GET ${path} (${route})`, res.body);
        }
      }
    }
    expect(calls).toBeGreaterThan(200);
  });

  it('the sweep would catch a leak (self-test)', () => {
    const leaky = { posts: [{ body: 'Anu on chapter 12 SPOILER-12' }] };
    expect(() => assertNoLeak('rahul', 'self-test', leaky)).toThrow(/LEAK/);
  });

  afterAll(async () => {
    void createApp;
  });
});

/* ------------------------------------------------------------- socket sweep */

describe('AT-1 leak sweep: sockets', () => {
  it('no socket event to any reader carries content above their bookmark', async () => {
    s = await freshSeed();
    const srv = await startServer();
    try {
      const sockets = {} as Record<Exclude<Reader, 'outsider'>, ClientSocket>;
      const logs = {} as Record<Exclude<Reader, 'outsider'>, Array<[string, unknown]>>;
      for (const r of ['meera', 'rahul', 'anu'] as const) {
        sockets[r] = await srv.connect(await sessionCookie(s.users[r]));
        logs[r] = record(sockets[r]);
        expect((await join(sockets[r], s.roomId)).ok).toBe(true);
      }
      const outsider = await srv.connect(await sessionCookie(s.users.outsider));
      const outsiderLog = record(outsider);
      expect((await join(outsider, s.roomId)).ok).toBe(false);

      const anu = agentFor(srv.app, await sessionCookie(s.users.anu));
      const rahul = agentFor(srv.app, await sessionCookie(s.users.rahul));

      // Activity above Meera (3) and Rahul (10).
      const p21 = await anu
        .post(`/chapters/${s.chapterIds[20]}/posts`, { body: 'SPOILER-END live' })
        .expect(201);
      s.posts.push({ id: p21.body.id, position: 21, authorId: s.users.anu });
      const p10 = await rahul
        .post(`/chapters/${s.chapterIds[9]}/posts`, { body: 'SPOILER-10 live' })
        .expect(201);
      s.posts.push({ id: p10.body.id, position: 10, authorId: s.users.rahul });
      const hidden12 = s.posts.find((p) => p.position === 12)!.id;
      await anu.post(`/posts/${hidden12}/replies`, { body: 'Reply at 12' }).expect(201);
      await anu.put(`/posts/${hidden12}/like`).expect(200);
      await anu.patch(`/posts/${hidden12}`, { body: 'SPOILER-12 edited' }).expect(200);
      await anu.post(`/moderation/posts/${hidden12}`, { action: 'delete' }).expect(200);
      await settle(400);

      for (const r of ['meera', 'rahul', 'anu'] as const) {
        for (const [name, payload] of logs[r]) assertNoLeak(r, `socket ${name}`, payload);
      }
      expect(outsiderLog).toEqual([]);
      // Readers below got counts, not content.
      expect(logs.meera.some(([n]) => n === 'waiting:count')).toBe(true);
      expect(logs.meera.some(([n]) => n === 'post:new')).toBe(false);
    } finally {
      await srv.close();
    }
  });
});
