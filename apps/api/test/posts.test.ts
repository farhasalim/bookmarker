import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SeedResult } from '@bookmarker/db/seed';
import { agents, db, freshSeed, makeDeps } from './helpers.ts';

let t: ReturnType<typeof makeDeps>;
let s: SeedResult;
let a: Awaited<ReturnType<typeof agents>>;

beforeEach(async () => {
  s = await freshSeed();
  t = makeDeps();
  a = await agents(t.app, s);
});
afterAll(() => db.$disconnect());

const ch = (p: number) => s.chapterIds[p - 1]!;
const postAt = (p: number, author: string) =>
  s.posts.find((x) => x.position === p && x.authorId === author)!.id;

describe('posting at the bookmark (FR-7, AT-3)', () => {
  it('reader at 3: chapter 2 or 4 → 403 NOT_AT_BOOKMARK; chapter 3 → created', async () => {
    for (const p of [2, 4]) {
      const res = await a.meera.post(`/chapters/${ch(p)}/posts`, { body: 'hi' }).expect(403);
      expect(res.body.error.code).toBe('NOT_AT_BOOKMARK');
    }
    const ok = await a.meera
      .post(`/chapters/${ch(3)}/posts`, { body: '  What a chapter.  ' })
      .expect(201);
    expect(ok.body).toMatchObject({
      position: 3,
      body: 'What a chapter.',
      mine: true,
      likeCount: 0,
    });
  });

  it('enforces 1–1,000 characters', async () => {
    await a.meera.post(`/chapters/${ch(3)}/posts`, { body: '   ' }).expect(400);
    await a.meera.post(`/chapters/${ch(3)}/posts`, { body: 'x'.repeat(1001) }).expect(400);
    await a.meera.post(`/chapters/${ch(3)}/posts`, { body: 'x'.repeat(1000) }).expect(201);
  });

  it('is 404 for a chapter in a club you are not in', async () => {
    await a.outsider.post(`/chapters/${ch(1)}/posts`, { body: 'hi' }).expect(404);
    await a.outsider.get(`/chapters/${ch(1)}/posts`).expect(404);
  });

  it('rate-limits to 20 posts an hour per reader', async () => {
    for (let i = 0; i < 20; i++)
      await a.meera.post(`/chapters/${ch(3)}/posts`, { body: `p${i}` }).expect(201);
    await a.meera.post(`/chapters/${ch(3)}/posts`, { body: 'one more' }).expect(429);
  });
});

describe('reading (AT-2, FR-8)', () => {
  it('AT-2: a reader at 3 asking for a chapter-10 post gets 404', async () => {
    const res = await a.meera.get(`/posts/${postAt(10, s.users.rahul)}`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('a locked chapter lists no posts', async () => {
    const res = await a.meera.get(`/chapters/${ch(10)}/posts`).expect(200);
    expect(res.body).toEqual({ posts: [], nextCursor: null });
  });

  it('paginates (max 50)', async () => {
    await a.meera.get(`/chapters/${ch(3)}/posts?limit=51`).expect(400);
    const res = await a.anu.get(`/chapters/${ch(8)}/posts?limit=1`).expect(200);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.nextCursor).toBeTruthy();
  });
});

describe('replies and likes (FR-10)', () => {
  it('work on a visible post and 404 on a hidden one', async () => {
    const visible = postAt(2, s.users.anu);
    const hidden = postAt(4, s.users.anu);
    await a.meera.post(`/posts/${visible}/replies`, { body: 'Agreed' }).expect(201);
    const list = await a.meera.get(`/posts/${visible}/replies`).expect(200);
    expect(list.body.replies.map((r: { body: string }) => r.body)).toContain('Agreed');
    await a.meera.post(`/posts/${hidden}/replies`, { body: 'x' }).expect(404);
    await a.meera.get(`/posts/${hidden}/replies`).expect(404);
    await a.meera.put(`/posts/${hidden}/like`).expect(404);
    await a.rahul
      .put(`/posts/${visible}/like`)
      .expect(200, { postId: visible, count: 2, likedByMe: true });
    await a.rahul
      .delete(`/posts/${visible}/like`)
      .expect(200, { postId: visible, count: 1, likedByMe: false });
  });

  it('a reply notifies the post author immediately, with no reply text', async () => {
    await a.meera
      .post(`/posts/${postAt(2, s.users.anu)}/replies`, { body: 'SECRET-REPLY-TEXT' })
      .expect(201);
    const n = await db.notification.findMany({ where: { type: 'reply' } });
    expect(n).toHaveLength(1);
    expect(n[0]!.userId).toBe(s.users.anu);
    expect(JSON.stringify(n[0]!.payload)).not.toContain('SECRET-REPLY-TEXT');
  });
});

describe('editing and deleting', () => {
  it('authors edit and delete their own posts only', async () => {
    const mine = postAt(3, s.users.meera);
    await a.rahul.patch(`/posts/${mine}`, { body: 'hijack' }).expect(404);
    const edited = await a.meera.patch(`/posts/${mine}`, { body: 'Edited' }).expect(200);
    expect(edited.body.editedAt).toBeTruthy();
    await a.rahul.delete(`/posts/${mine}`).expect(404);
    await a.meera.delete(`/posts/${mine}`).expect(204);
    await a.meera.get(`/posts/${mine}`).expect(404);
  });
});

describe('notifications are queued for the audience at post time (FR-12, AT-6)', () => {
  it('a chapter-10 post queues one for the Finished reader only, batched to the next half hour', async () => {
    const res = await a.rahul.post(`/chapters/${ch(10)}/posts`, { body: 'Big moment' }).expect(201);
    const rows = await db.notification.findMany({ where: { postId: res.body.id } });
    expect(rows.map((r) => r.userId)).toEqual([s.users.anu]);
    expect(rows[0]!.sendAfter.toISOString()).toBe('2026-10-01T06:30:00.000Z');
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('Big moment');
    expect(rows[0]!.sentAt).toBeNull(); // the worker sends it, after re-checking the gate
  });

  it('nothing is created for the reader at 3 when they later reach chapter 10', async () => {
    const res = await a.rahul.post(`/chapters/${ch(10)}/posts`, { body: 'Later' }).expect(201);
    await a.meera.put(`/rooms/${s.roomId}/bookmark`, { position: 10 }).expect(200);
    const forMeera = await db.notification.count({
      where: { postId: res.body.id, userId: s.users.meera },
    });
    expect(forMeera).toBe(0);
  });

  it('lists only delivered notifications, and marks them read', async () => {
    const n = await db.notification.create({
      data: {
        userId: s.users.meera,
        type: 'reply',
        payload: { replierName: 'Rahul', position: 2 },
        sentAt: new Date(),
      },
    });
    await db.notification.create({
      data: { userId: s.users.meera, type: 'post', payload: {}, sentAt: null },
    });
    const list = await a.meera.get('/notifications').expect(200);
    expect(list.body.unread).toBe(1);
    expect(list.body.notifications).toHaveLength(1);
    await a.meera.patch(`/notifications/${n.id}`, { read: true }).expect(200);
    expect((await a.meera.get('/notifications')).body.unread).toBe(0);
    await a.rahul.patch(`/notifications/${n.id}`, { read: true }).expect(404);
  });
});

describe('reports and moderation (FR-19)', () => {
  it('a member reports a visible post; a host sees it and deletes it', async () => {
    const target = postAt(1, s.users.meera);
    await a.rahul.post('/reports', { postId: target, reason: 'spoiler' }).expect(201);
    const reports = await a.anu.get(`/clubs/${s.clubId}/reports`).expect(200);
    expect(reports.body.reports[0]).toMatchObject({
      postId: target,
      position: 1,
      body: 'Meera on chapter 1',
    });
    await a.rahul.get(`/clubs/${s.clubId}/reports`).expect(403);
    await a.rahul.post(`/moderation/posts/${target}`, { action: 'delete' }).expect(403);
    await a.anu.post(`/moderation/posts/${target}`, { action: 'delete' }).expect(200);
    await a.meera.get(`/posts/${target}`).expect(404);
    expect((await a.anu.get(`/clubs/${s.clubId}/reports`)).body.reports).toEqual([]);
  });

  it('you cannot report a post you cannot see', async () => {
    await a.meera.post('/reports', { postId: postAt(10, s.users.rahul) }).expect(404);
  });

  it('a host behind a reported post sees the chapter number, not the text', async () => {
    await a.anu.patch(`/clubs/${s.clubId}/members/${s.users.meera}`, { role: 'host' }).expect(200);
    await a.rahul.post('/reports', { postId: postAt(8, s.users.anu) }).expect(201);
    const res = await a.meera.get(`/clubs/${s.clubId}/reports`).expect(200);
    expect(res.body.reports[0]).toMatchObject({
      position: 8,
      postId: null,
      body: null,
      authorName: null,
    });
    // ...and can still remove it without reading it, through the report.
    await a.meera
      .post(`/moderation/reports/${res.body.reports[0].reportId}`, { action: 'delete' })
      .expect(200);
    await a.anu.get(`/posts/${postAt(8, s.users.anu)}`).expect(404);
    await a.rahul
      .post(`/moderation/reports/${res.body.reports[0].reportId}`, { action: 'delete' })
      .expect(404);
  });

  it('there is no "hide" action (decision #13)', async () => {
    await a.anu
      .post(`/moderation/posts/${postAt(1, s.users.meera)}`, { action: 'hide' })
      .expect(400);
  });
});

describe('profile, export and account deletion (FR-18, SEC-11)', () => {
  it('club-mates see stars and finished books; ratings only if they finished too or it is public', async () => {
    const res = await a.rahul.get(`/users/${s.users.anu}/profile`).expect(200);
    expect(res.body).toMatchObject({ name: 'Anu', booksFinished: 1 });
    expect(res.body.books[0]).toMatchObject({
      title: 'Pride and Prejudice',
      rating: null,
      review: null,
    });
    await a.outsider.get(`/users/${s.users.anu}/profile`).expect(404);
  });

  it('exports my data as JSON', async () => {
    const res = await a.meera.get('/me/export').expect(200);
    expect(res.headers['content-disposition']).toContain('bookmarker-export.json');
    expect(res.body.profile.email).toBe('meera@example.test');
    expect(res.body.posts).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toContain('SPOILER');
  });

  it('deleting my account keeps my posts as "Former member" and passes on hosting', async () => {
    await a.anu.delete('/me').expect(204);
    await a.anu.get('/me').expect(401);
    const post = await a.rahul.get(`/posts/${postAt(2, s.users.anu)}`).expect(200);
    expect(post.body.author.name).toBe('Former member');
    const club = await a.rahul.get(`/clubs/${s.clubId}`).expect(200);
    expect(club.body.members.find((m: { role: string }) => m.role === 'host')).toBeTruthy();
  });

  it('updates name, time zone and notification settings (FR-20)', async () => {
    const res = await a.meera
      .patch('/me', { timezone: 'Europe/London', notificationPrefs: { weeklyEmail: false } })
      .expect(200);
    expect(res.body.timezone).toBe('Europe/London');
    expect(res.body.notificationPrefs).toMatchObject({ weeklyEmail: false, remindersEmail: true });
    await a.meera.patch('/me', { timezone: 'Mars/Olympus' }).expect(400);
  });
});
