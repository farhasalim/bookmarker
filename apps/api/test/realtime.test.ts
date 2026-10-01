import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeedResult } from '@bookmarker/db/seed';
import type { PostDTO } from '@bookmarker/shared';
import { agentFor, db, freshSeed, sessionCookie } from './helpers.ts';
import { join, record, settle, startServer, until } from './realtime-helpers.ts';

let s: SeedResult;
let srv: Awaited<ReturnType<typeof startServer>>;

beforeEach(async () => {
  s = await freshSeed();
  srv = await startServer();
});
afterEach(() => srv.close());
afterAll(() => db.$disconnect());

const cookie = (u: keyof SeedResult['users']) => sessionCookie(s.users[u]);

describe('connecting (SEC-8)', () => {
  it('refuses sockets without a session', async () => {
    await expect(srv.connect('bm_session=nope')).rejects.toThrow(/unauthenticated/);
  });
  it('refuses sockets from another origin', async () => {
    await expect(srv.connect(await cookie('meera'), 'https://evil.example')).rejects.toThrow(
      /origin/,
    );
  });
  it('refuses to join a room in someone else’s club', async () => {
    const sock = await srv.connect(await cookie('outsider'));
    expect(await join(sock, s.roomId)).toEqual({ ok: false });
  });
});

describe('AT-5: live gate', () => {
  it('a chapter-10 post reaches the Finished reader as post:new within 2 s; the reader at 3 gets a count only', async () => {
    const meera = await srv.connect(await cookie('meera'));
    const anu = await srv.connect(await cookie('anu'));
    const meeraLog = record(meera);
    const anuLog = record(anu);
    await join(meera, s.roomId);
    await join(anu, s.roomId);

    const started = Date.now();
    await agentFor(srv.app, await cookie('rahul'))
      .post(`/chapters/${s.chapterIds[9]}/posts`, { body: 'Live at ten' })
      .expect(201);
    await until(() => anuLog.some(([n]) => n === 'post:new'), 2000);
    expect(Date.now() - started).toBeLessThan(2000);

    const delivered = anuLog.find(([n]) => n === 'post:new')![1] as { post: PostDTO };
    expect(delivered.post).toMatchObject({ body: 'Live at ten', position: 10, mine: false });

    await until(() => meeraLog.some(([n]) => n === 'waiting:count'));
    expect(meeraLog.filter(([n]) => n === 'post:new')).toEqual([]);
    expect(meeraLog.find(([n]) => n === 'waiting:count')![1]).toMatchObject({
      position: 10,
      count: 3,
    });
  });

  it('replies and likes go only to sockets that can see the post', async () => {
    const meera = await srv.connect(await cookie('meera'));
    const rahul = await srv.connect(await cookie('rahul'));
    const meeraLog = record(meera);
    const rahulLog = record(rahul);
    await join(meera, s.roomId);
    await join(rahul, s.roomId);
    const post8 = s.posts.find((p) => p.position === 8 && p.authorId === s.users.anu)!.id;
    const anu = agentFor(srv.app, await cookie('anu'));
    await anu.post(`/posts/${post8}/replies`, { body: 'hello' }).expect(201);
    await anu.put(`/posts/${post8}/like`).expect(200);
    await until(() => rahulLog.some(([n]) => n === 'like:update'));
    expect(rahulLog.map(([n]) => n)).toEqual(expect.arrayContaining(['reply:new', 'like:update']));
    await settle();
    expect(meeraLog.map(([n]) => n)).not.toContain('reply:new');
    expect(meeraLog.map(([n]) => n)).not.toContain('like:update');
  });
});

describe('unlock and relock across tabs (AT-7, AT-8)', () => {
  it('moving forward in one tab sends the other tab one unlock with exactly the new posts', async () => {
    const tabA = await srv.connect(await cookie('meera'));
    const tabB = await srv.connect(await cookie('meera'));
    const logB = record(tabB);
    await join(tabA, s.roomId);
    await join(tabB, s.roomId);
    await agentFor(srv.app, await cookie('meera'))
      .put(`/rooms/${s.roomId}/bookmark`, { position: 8 })
      .expect(200);
    await until(() => logB.some(([n]) => n === 'unlock'));
    const unlocks = logB.filter(([n]) => n === 'unlock');
    expect(unlocks).toHaveLength(1);
    const ev = unlocks[0]![1] as { from: number; to: number; posts: PostDTO[] };
    expect(ev).toMatchObject({ from: 3, to: 8 });
    expect(ev.posts.map((p) => p.position).sort((x, y) => x - y)).toEqual([4, 5, 6, 8, 8]);

    // After the move, a new chapter-8 post now reaches this socket live.
    await agentFor(srv.app, await cookie('anu'))
      .post(`/chapters/${s.chapterIds[20]}/posts`, { body: 'after' })
      .expect(201);
    await settle();
    expect(logB.filter(([n]) => n === 'post:new')).toEqual([]); // still above 8
  });

  it('moving back sends relock; friends get bookmark:update unless the position is hidden', async () => {
    const rahulTab = await srv.connect(await cookie('rahul'));
    const meera = await srv.connect(await cookie('meera'));
    const rahulLog = record(rahulTab);
    const meeraLog = record(meera);
    await join(rahulTab, s.roomId);
    await join(meera, s.roomId);
    const rahul = agentFor(srv.app, await cookie('rahul'));
    await rahul.put(`/rooms/${s.roomId}/bookmark`, { position: 5 }).expect(200);
    await until(() => rahulLog.some(([n]) => n === 'relock'));
    expect(rahulLog.find(([n]) => n === 'relock')![1]).toMatchObject({ position: 5 });
    await until(() => meeraLog.some(([n]) => n === 'bookmark:update'));
    expect(meeraLog.find(([n]) => n === 'bookmark:update')![1]).toMatchObject({
      userId: s.users.rahul,
      position: 5,
    });

    await rahul.patch(`/clubs/${s.clubId}/me`, { positionHidden: true }).expect(200);
    meeraLog.length = 0;
    await rahul.put(`/rooms/${s.roomId}/bookmark`, { position: 6 }).expect(200);
    await settle();
    expect(meeraLog.filter(([n]) => n === 'bookmark:update')).toEqual([]);
  });

  it('finishing tells the room, with no rating', async () => {
    const meera = await srv.connect(await cookie('meera'));
    const log = record(meera);
    await join(meera, s.roomId);
    await agentFor(srv.app, await cookie('rahul')).put(`/rooms/${s.roomId}/bookmark`, {
      position: 10,
      finished: true,
    });
    await until(() => log.some(([n]) => n === 'finished'));
    expect(log.find(([n]) => n === 'finished')![1]).toEqual(
      expect.objectContaining({ userId: s.users.rahul }),
    );
    expect(JSON.stringify(log)).not.toMatch(/rating/);
  });
});

describe('reconnect replay (room:join with lastSeq)', () => {
  it('replays missed events through the gate for the reader as they are now', async () => {
    const first = await srv.connect(await cookie('rahul'));
    const { seq } = await join(first, s.roomId);
    first.disconnect();

    const anu = agentFor(srv.app, await cookie('anu'));
    await anu
      .post(`/chapters/${s.chapterIds[20]}/posts`, { body: 'missed after-book' })
      .expect(201); // hidden from Rahul
    await agentFor(srv.app, await cookie('meera'))
      .post(`/chapters/${s.chapterIds[2]}/posts`, { body: 'missed at 3' })
      .expect(201);

    const again = await srv.connect(await cookie('rahul'));
    const log = record(again);
    await join(again, s.roomId, seq);
    await until(() => log.some(([n]) => n === 'room:replay-done'));
    const posts = log
      .filter(([n]) => n === 'post:new')
      .map(([, p]) => (p as { post: PostDTO }).post.body);
    expect(posts).toEqual(['missed at 3']);
    expect(log.some(([n]) => n === 'waiting:count')).toBe(true);
  });
});
