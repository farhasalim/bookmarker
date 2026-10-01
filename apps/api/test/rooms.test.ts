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

type Ch = {
  id: string;
  position: number;
  title: string;
  kind: string;
  unlocked: boolean;
  count: number;
};

describe('GET /rooms/:id (FR-9, AT-4)', () => {
  it('a reader at 3 sees chapters 4–20 as titles and waiting counts only', async () => {
    const res = await a.meera.get(`/rooms/${s.roomId}`).expect(200);
    const chapters: Ch[] = res.body.chapters;
    expect(chapters).toHaveLength(21);
    for (const c of chapters.filter((c) => c.position >= 4)) {
      expect(Object.keys(c).sort()).toEqual([
        'count',
        'id',
        'kind',
        'position',
        'title',
        'unlocked',
      ]);
      expect(c.unlocked).toBe(false);
    }
    expect(chapters.find((c) => c.position === 3)).toMatchObject({ unlocked: true, count: 2 });
    expect(chapters.find((c) => c.position === 10)).toMatchObject({ unlocked: false, count: 2 });
    expect(chapters.find((c) => c.position === 21)).toMatchObject({
      kind: 'after_book',
      unlocked: false,
      count: 1,
    });
    expect(res.body.me).toEqual({ position: 3, finished: false, isHost: false });
  });

  it('lists friends with chapter numbers only', async () => {
    const res = await a.meera.get(`/rooms/${s.roomId}`).expect(200);
    expect(res.body.friends).toEqual([
      { userId: s.users.anu, name: 'Anu', position: 20, finished: true },
      { userId: s.users.rahul, name: 'Rahul', position: 10, finished: false },
    ]);
  });

  it('is 404 for non-members', async () => {
    await a.outsider.get(`/rooms/${s.roomId}`).expect(404);
  });
});

describe('PUT /rooms/:id/bookmark (FR-6, AT-7, AT-8)', () => {
  it('AT-7: moving 3 → 8 returns exactly the chapter 4–8 posts', async () => {
    const res = await a.meera.put(`/rooms/${s.roomId}/bookmark`, { position: 8 }).expect(200);
    expect(res.body).toMatchObject({ from: 3, to: 8, finished: false });
    const positions = res.body.posts
      .map((p: { position: number }) => p.position)
      .sort((x: number, y: number) => x - y);
    expect(positions).toEqual([4, 5, 6, 8, 8]);
  });

  it('AT-8: moving back hides chapters above again, except my own posts', async () => {
    await a.rahul.put(`/rooms/${s.roomId}/bookmark`, { position: 5 }).expect(200);
    const ch8 = await a.rahul.get(`/chapters/${s.chapterIds[7]}/posts`).expect(200);
    expect(ch8.body.posts.map((p: { body: string }) => p.body)).toEqual(['Rahul on chapter 8']);
  });

  it('marking Finished unlocks everything and stops reminders', async () => {
    const res = await a.rahul
      .put(`/rooms/${s.roomId}/bookmark`, { position: 10, finished: true })
      .expect(200);
    expect(res.body).toMatchObject({ to: 20, finished: true });
    expect(res.body.posts.map((p: { position: number }) => p.position)).toContain(21);
    const nudge = await db.nudgeSchedule.findUnique({
      where: { userId_roomId: { userId: s.users.rahul, roomId: s.roomId } },
    });
    expect(nudge).toBeNull();
    const n = await db.notification.findMany({ where: { type: 'friend_finished' } });
    expect(n.map((x) => x.userId).sort()).toEqual([s.users.anu, s.users.meera].sort());
    expect(JSON.stringify(n.map((x) => x.payload))).not.toMatch(/rating/);
  });

  it('can go back to 0 (not started)', async () => {
    await a.meera.put(`/rooms/${s.roomId}/bookmark`, { position: 0 }).expect(200);
    const room = await a.meera.get(`/rooms/${s.roomId}`).expect(200);
    expect(room.body.chapters.every((c: Ch) => !c.unlocked)).toBe(true);
  });

  it('rejects a position past the last chapter', async () => {
    await a.meera.put(`/rooms/${s.roomId}/bookmark`, { position: 21 }).expect(400);
    await a.meera.put(`/rooms/${s.roomId}/bookmark`, { position: -1 }).expect(400);
  });

  it('pushes the next reminder out to 3 days after the move', async () => {
    await a.meera.put(`/rooms/${s.roomId}/bookmark`, { position: 4 }).expect(200);
    const nudge = await db.nudgeSchedule.findUniqueOrThrow({
      where: { userId_roomId: { userId: s.users.meera, roomId: s.roomId } },
    });
    expect(nudge.nextReminderAt.getTime() - t.clock.now().getTime()).toBe(3 * 24 * 3600 * 1000);
  });
});

describe('opening a room and the chapter lock (FR-4, FR-5, decision #11)', () => {
  async function newClubWithRoom() {
    const club = (await a.outsider.post('/clubs', { name: 'Fresh Club' }).expect(201)).body
      .id as string;
    const room = await a.outsider
      .post(`/clubs/${club}/rooms`, {
        title: 'Middlemarch',
        author: 'George Eliot',
        chapters: Array.from({ length: 5 }, (_, i) => ({ title: `Chapter ${i + 1}` })),
      })
      .expect(201);
    return { club, room: room.body.id as string };
  }

  it('creates a draft room; nobody can move a bookmark until the host confirms', async () => {
    const { room } = await newClubWithRoom();
    const res = await a.outsider.get(`/rooms/${room}`).expect(200);
    expect(res.body.chaptersConfirmed).toBe(false);
    expect(res.body.chapters).toHaveLength(6);
    const err = await a.outsider.put(`/rooms/${room}/bookmark`, { position: 1 }).expect(409);
    expect(err.body.error.code).toBe('CHAPTERS_NOT_CONFIRMED');
  });

  it('allows one current room per club on the free plan (plan config)', async () => {
    const { club } = await newClubWithRoom();
    const res = await a.outsider
      .post(`/clubs/${club}/rooms`, { title: 'Second', chapters: [{ title: 'One' }] })
      .expect(409);
    expect(res.body.error.code).toBe('PLAN_LIMIT');
  });

  it('only hosts open rooms and edit chapters', async () => {
    await a.rahul
      .post(`/clubs/${s.clubId}/rooms`, { title: 'X', chapters: [{ title: 'One' }] })
      .expect(403);
    await a.rahul.put(`/rooms/${s.roomId}/chapters`, { chapters: [{ title: 'One' }] }).expect(403);
  });

  it('a draft can be freely edited, then confirmed', async () => {
    const { room } = await newClubWithRoom();
    const draft = (await a.outsider.get(`/rooms/${room}`)).body;
    const list = draft.chapters.filter((c: Ch) => c.kind === 'chapter');
    const reordered = [list[2], list[0], { title: 'Interlude' }, list[1]].map((c) => ({
      id: c.id,
      title: c.title,
    }));
    const res = await a.outsider
      .put(`/rooms/${room}/chapters`, { chapters: reordered, confirm: true })
      .expect(200);
    expect(res.body.chaptersConfirmed).toBe(true);
    expect(res.body.chapters.map((c: Ch) => c.title)).toEqual([
      'Chapter 3',
      'Chapter 1',
      'Interlude',
      'Chapter 2',
      'After the book',
    ]);
    await a.outsider.put(`/rooms/${room}/bookmark`, { position: 1 }).expect(200);
  });

  it('after confirmation, chapters up to the furthest reader are frozen except for renaming', async () => {
    // Seed room: a Finished reader means every chapter has been reached.
    const room = (await a.anu.get(`/rooms/${s.roomId}`)).body;
    expect(room.frozenThrough).toBe(20);
    const chapters = room.chapters
      .filter((c: Ch) => c.kind === 'chapter')
      .map((c: Ch) => ({ id: c.id, title: c.title }));

    const swapped = [chapters[1], chapters[0], ...chapters.slice(2)];
    const err = await a.anu.put(`/rooms/${s.roomId}/chapters`, { chapters: swapped }).expect(409);
    expect(err.body.error.code).toBe('CHAPTERS_LOCKED');

    const renamed = chapters.map((c: { id: string; title: string }, i: number) => ({
      ...c,
      title: i === 0 ? 'Opening' : c.title,
    }));
    const ok = await a.anu.put(`/rooms/${s.roomId}/chapters`, { chapters: renamed }).expect(200);
    expect(ok.body.chapters[0].title).toBe('Opening');

    const extended = [...chapters, { title: 'Epilogue' }];
    const ext = await a.anu.put(`/rooms/${s.roomId}/chapters`, { chapters: extended }).expect(200);
    expect(ext.body.chapterCount).toBe(21);
    expect(ext.body.chapters.at(-1)).toMatchObject({ kind: 'after_book', position: 22 });
  });

  it('chapters above everyone can be added, removed and reordered', async () => {
    const { room } = await newClubWithRoom();
    const draft = (await a.outsider.get(`/rooms/${room}`)).body;
    const list = draft.chapters
      .filter((c: Ch) => c.kind === 'chapter')
      .map((c: Ch) => ({ id: c.id, title: c.title }));
    await a.outsider.put(`/rooms/${room}/chapters`, { chapters: list, confirm: true }).expect(200);
    await a.outsider.put(`/rooms/${room}/bookmark`, { position: 2 }).expect(200);

    const changed = [list[0], list[1], list[4], list[2]]; // drop chapter 4, move 5 up
    const res = await a.outsider.put(`/rooms/${room}/chapters`, { chapters: changed }).expect(200);
    expect(res.body.chapters.map((c: Ch) => c.title)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 5',
      'Chapter 3',
      'After the book',
    ]);

    const breaks = [list[1], list[0], list[2]];
    await a.outsider.put(`/rooms/${room}/chapters`, { chapters: breaks }).expect(409);
  });

  it('closing a room frees the slot for the next book', async () => {
    const { club, room } = await newClubWithRoom();
    await a.outsider.post(`/rooms/${room}/close`).expect(200);
    await a.outsider
      .post(`/clubs/${club}/rooms`, { title: 'Next', chapters: [{ title: 'One' }] })
      .expect(201);
  });

  it('proxies book search', async () => {
    const res = await a.meera.get('/books/search?q=pride').expect(200);
    expect(res.body.results[0].title).toBe('Result for pride');
  });
});
