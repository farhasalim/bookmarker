import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '@bookmarker/db';
import { seed, type SeedResult } from '@bookmarker/db/seed';
import { resetDb } from '@bookmarker/db/testing';
import {
  chapterCounts,
  createPost,
  createReply,
  getVisiblePost,
  listChapterPosts,
  listReplies,
  listRoomReviews,
  loadRoomAccess,
  postAudience,
  postsUnlockedBetween,
  profileBooks,
  setLike,
  softDeletePost,
  upsertReview,
  type RoomAccess,
} from '../src/index.ts';

const db = createDb();
let s: SeedResult;

async function access(userId: string): Promise<RoomAccess> {
  const a = await loadRoomAccess(db, userId, s.roomId);
  if (!a) throw new Error('not a member');
  return a;
}
const ch = (p: number) => s.chapterIds[p - 1]!;
const postAt = (p: number, author: string) =>
  s.posts.find((x) => x.position === p && x.authorId === author)!.id;

beforeEach(async () => {
  await resetDb(db);
  s = await seed(db);
});
afterAll(() => db.$disconnect());

describe('loadRoomAccess', () => {
  it('returns null for someone outside the club (so the API answers 404)', async () => {
    expect(await loadRoomAccess(db, s.users.outsider, s.roomId)).toBeNull();
  });
  it('reads the bookmark', async () => {
    const a = await access(s.users.meera);
    expect(a.viewer).toMatchObject({ position: 3, finished: false });
    expect(a.afterBookPosition).toBe(21);
  });
});

describe('reading posts', () => {
  it('shows a reader at 3 the posts in chapter 3', async () => {
    const { viewer } = await access(s.users.meera);
    const { posts } = await listChapterPosts(db, viewer, ch(3), { limit: 50 });
    expect(posts.map((p) => p.body).sort()).toEqual(['Meera on chapter 3', 'Rahul on chapter 3']);
  });

  it('shows a reader at 3 nothing in chapter 4', async () => {
    const { viewer } = await access(s.users.meera);
    const { posts } = await listChapterPosts(db, viewer, ch(4), { limit: 50 });
    expect(posts).toEqual([]);
  });

  it('AT-2: a post above the bookmark is 404, same as one that does not exist', async () => {
    const { viewer } = await access(s.users.meera);
    await expect(getVisiblePost(db, viewer, postAt(10, s.users.rahul))).rejects.toMatchObject({ status: 404 });
    await expect(getVisiblePost(db, viewer, '019a0000-0000-7000-8000-000000000000')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('AT-4: locked chapters give a waiting count, unlocked ones a visible count', async () => {
    const { viewer } = await access(s.users.meera);
    const { visible, waiting } = await chapterCounts(db, viewer);
    expect(visible.get(ch(3))).toBe(2);
    expect(waiting.get(ch(3))).toBeUndefined();
    expect(visible.get(ch(4))).toBeUndefined();
    expect(waiting.get(ch(4))).toBe(1);
    expect(waiting.get(ch(10))).toBe(2);
  });

  it('a Finished reader sees everything, including After the book', async () => {
    const { viewer } = await access(s.users.anu);
    const { posts } = await listChapterPosts(db, viewer, ch(21), { limit: 50 });
    expect(posts).toHaveLength(1);
  });

  it('a reader at 20 who has not finished cannot see After the book', async () => {
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.rahul, roomId: s.roomId } },
      data: { position: 20 },
    });
    const { viewer } = await access(s.users.rahul);
    const { posts } = await listChapterPosts(db, viewer, ch(21), { limit: 50 });
    expect(posts).toEqual([]);
  });

  it('readers keep their own posts after moving back (PRD rule 7)', async () => {
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.rahul, roomId: s.roomId } },
      data: { position: 5 },
    });
    const { viewer } = await access(s.users.rahul);
    const own = await listChapterPosts(db, viewer, ch(8), { limit: 50 });
    expect(own.posts.map((p) => p.body)).toEqual(['Rahul on chapter 8']);
  });

  it('deleted posts disappear for everyone, author included', async () => {
    const id = postAt(3, s.users.meera);
    await softDeletePost(db, await access(s.users.meera), id);
    const { viewer } = await access(s.users.meera);
    await expect(getVisiblePost(db, viewer, id)).rejects.toMatchObject({ status: 404 });
  });

  it('paginates with a cursor', async () => {
    const { viewer } = await access(s.users.anu);
    const first = await listChapterPosts(db, viewer, ch(8), { limit: 1 });
    expect(first.posts).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listChapterPosts(db, viewer, ch(8), { limit: 1, cursor: first.nextCursor! });
    expect(second.posts[0]!.id).not.toBe(first.posts[0]!.id);
    expect(second.nextCursor).toBeNull();
  });
});

describe('AT-7: unlock payload', () => {
  it('moving 3 → 8 returns exactly the chapter 4–8 posts by others', async () => {
    const { viewer } = await access(s.users.meera);
    const moved = { ...viewer, position: 8 };
    const posts = await postsUnlockedBetween(db, moved, 3, 8);
    expect(posts.map((p) => p.position).sort((a, b) => a - b)).toEqual([4, 5, 6, 8, 8]);
  });
  it('finishing unlocks everything above, including After the book', async () => {
    const { viewer } = await access(s.users.rahul);
    const posts = await postsUnlockedBetween(db, { ...viewer, finished: true }, 10, Number.POSITIVE_INFINITY);
    expect(posts.map((p) => p.position).sort((a, b) => a - b)).toEqual([12, 15, 20, 21]);
  });
});

describe('AT-3: writing posts only at the bookmark', () => {
  it('rejects chapters 2 and 4 for a reader at 3, accepts 3', async () => {
    const a = await access(s.users.meera);
    await expect(createPost(db, a, ch(2), 'x')).rejects.toMatchObject({ status: 403, code: 'NOT_AT_BOOKMARK' });
    await expect(createPost(db, a, ch(4), 'x')).rejects.toMatchObject({ status: 403, code: 'NOT_AT_BOOKMARK' });
    const p = await createPost(db, a, ch(3), 'hello');
    expect(p).toMatchObject({ position: 3, mine: true, body: 'hello' });
  });

  it('lets Finished readers post only After the book', async () => {
    const a = await access(s.users.anu);
    await expect(createPost(db, a, ch(20), 'x')).rejects.toMatchObject({ code: 'NOT_AT_BOOKMARK' });
    await expect(createPost(db, a, ch(21), 'the end')).resolves.toMatchObject({ position: 21 });
  });

  it('refuses posts before the host confirms the chapter list', async () => {
    await db.room.update({ where: { id: s.roomId }, data: { chaptersConfirmedAt: null } });
    const a = await access(s.users.meera);
    await expect(createPost(db, a, ch(3), 'x')).rejects.toMatchObject({ code: 'CHAPTERS_NOT_CONFIRMED' });
  });

  it('treats a chapter from another room as missing', async () => {
    const a = await access(s.users.meera);
    await expect(createPost(db, a, '019a0000-0000-7000-8000-000000000000', 'x')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('replies and likes inherit their post gate', () => {
  it('404s replies and likes on a post above the bookmark', async () => {
    const { viewer } = await access(s.users.meera);
    const hidden = postAt(10, s.users.anu);
    await expect(listReplies(db, viewer, hidden)).rejects.toMatchObject({ status: 404 });
    await expect(createReply(db, viewer, hidden, 'x')).rejects.toMatchObject({ status: 404 });
    await expect(setLike(db, viewer, hidden, true)).rejects.toMatchObject({ status: 404 });
  });

  it('allows them on a visible post', async () => {
    const { viewer } = await access(s.users.meera);
    const visible = postAt(2, s.users.anu);
    const { reply } = await createReply(db, viewer, visible, 'nice');
    expect(reply.mine).toBe(true);
    const like = await setLike(db, viewer, visible, true);
    expect(like.count).toBe(1); // Meera already liked it in the seed; upsert is idempotent
    const unlike = await setLike(db, viewer, visible, false);
    expect(unlike.count).toBe(0);
  });
});

describe('FR-12: who may be told about a post', () => {
  it('a chapter-10 post reaches the Finished reader, never the reader at 3, never the author', async () => {
    const audience = await postAudience(db, postAt(10, s.users.rahul));
    expect(audience.map((v) => v.userId)).toEqual([s.users.anu]);
  });

  it('re-checks at send time: a reader who moved back drops out', async () => {
    const id = postAt(8, s.users.anu);
    expect((await postAudience(db, id)).map((v) => v.userId)).toContain(s.users.rahul);
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.rahul, roomId: s.roomId } },
      data: { position: 7 },
    });
    expect((await postAudience(db, id)).map((v) => v.userId)).not.toContain(s.users.rahul);
  });

  it('excludes people who left the club', async () => {
    await db.membership.delete({ where: { clubId_userId: { clubId: s.clubId, userId: s.users.anu } } });
    expect(await postAudience(db, postAt(10, s.users.rahul))).toEqual([]);
  });

  it('deleted posts notify nobody', async () => {
    const id = postAt(1, s.users.meera);
    await softDeletePost(db, await access(s.users.meera), id);
    expect(await postAudience(db, id)).toEqual([]);
  });
});

describe('moderation', () => {
  it('a host can delete a post, a member cannot delete someone else’s', async () => {
    const target = postAt(1, s.users.meera);
    await expect(softDeletePost(db, await access(s.users.rahul), target)).rejects.toMatchObject({ status: 404 });
    await expect(softDeletePost(db, await access(s.users.anu), target)).resolves.toMatchObject({ position: 1 });
  });
});

describe('reviews, ratings and stars', () => {
  it('AT-11: a reader at 10 gets NOT_FINISHED; the Finished reader sees reviews', async () => {
    await expect(listRoomReviews(db, (await access(s.users.rahul)).viewer)).rejects.toMatchObject({
      code: 'NOT_FINISHED',
    });
    const reviews = await listRoomReviews(db, (await access(s.users.anu)).viewer);
    expect(reviews).toHaveLength(1);
  });

  it('AT-12: rating +1, 60-char review +1, editing changes nothing, total 2', async () => {
    const { viewer } = await access(s.users.anu);
    await db.review.delete({ where: { roomId_userId: { roomId: s.roomId, userId: s.users.anu } } });
    const r1 = await upsertReview(db, viewer, { rating: 5, isPublic: false });
    expect(r1.starsAwarded).toEqual(['rated']);
    const r2 = await upsertReview(db, viewer, { rating: 5, body: 'x'.repeat(60), isPublic: false });
    expect(r2.starsAwarded).toEqual(['reviewed']);
    const r3 = await upsertReview(db, viewer, { rating: 4, body: 'y'.repeat(80), isPublic: true });
    expect(r3.starsAwarded).toEqual([]);
    const u = await db.user.findUniqueOrThrow({ where: { id: s.users.anu } });
    expect(u.starTotal).toBe(2);
  });

  it('a short review saves but earns no review star', async () => {
    const { viewer } = await access(s.users.anu);
    const r = await upsertReview(db, viewer, { rating: 3, body: 'Too short', isPublic: false });
    expect(r.review.body).toBe('Too short');
    expect(r.starsAwarded).toEqual(['rated']);
  });

  it('AT-13: someone who joined 1 day ago saves a rating but earns no star', async () => {
    await db.bookmark.update({
      where: { userId_roomId: { userId: s.users.anu, roomId: s.roomId } },
      data: { joinedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const r = await upsertReview(db, (await access(s.users.anu)).viewer, { rating: 2, isPublic: false });
    expect(r.review.rating).toBe(2);
    expect(r.starsAwarded).toEqual([]);
  });

  it('a reader who has not finished cannot rate', async () => {
    await expect(
      upsertReview(db, (await access(s.users.rahul)).viewer, { rating: 5, isPublic: false }),
    ).rejects.toMatchObject({ code: 'NOT_FINISHED' });
  });

  it('profile: rating and review hidden from an unfinished club-mate unless made public', async () => {
    const hidden = await profileBooks(db, s.users.anu, s.users.rahul);
    expect(hidden[0]).toMatchObject({ rating: null, review: null });

    await db.review.update({
      where: { roomId_userId: { roomId: s.roomId, userId: s.users.anu } },
      data: { isPublic: true },
    });
    const shown = await profileBooks(db, s.users.anu, s.users.rahul);
    expect(shown[0]).toMatchObject({ rating: 4, review: { spoilerGuarded: true } });

    const own = await profileBooks(db, s.users.anu, s.users.anu);
    expect(own[0]).toMatchObject({ rating: 4, review: { spoilerGuarded: false } });
  });
});
