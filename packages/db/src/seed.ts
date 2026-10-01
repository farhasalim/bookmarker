import type { PrismaClient } from './generated/client.ts';

/**
 * The acceptance-test room (SRS section 10): one 20-chapter book and three readers
 * with bookmarks at 3, 10 and Finished. Also used for local dev and staging demos.
 *
 * Every reader only ever posted where the rules allowed them to at the time, and
 * each chapter has posts by several people so leaks are easy to spot.
 */
export interface SeedResult {
  clubId: string;
  roomId: string;
  chapterIds: string[]; // index 0 = chapter 1; last = "After the book" (position 21)
  users: { meera: string; rahul: string; anu: string; outsider: string };
  /** Every post with the position it sits at, for leak sweeps. */
  posts: Array<{ id: string; position: number; authorId: string }>;
  replies: Array<{ id: string; postId: string; position: number }>;
}

export const SEED_CHAPTERS = 20;
const DAY = 24 * 60 * 60 * 1000;

export async function seed(db: PrismaClient, now = new Date()): Promise<SeedResult> {
  const longAgo = new Date(now.getTime() - 30 * DAY);
  const mk = (email: string, name: string) =>
    db.user.create({ data: { email, name, timezone: 'Asia/Kolkata' } });
  const [meera, rahul, anu, outsider] = await Promise.all([
    mk('meera@example.test', 'Meera'),
    mk('rahul@example.test', 'Rahul'),
    mk('anu@example.test', 'Anu'),
    mk('outsider@example.test', 'Outsider'),
  ]);

  const club = await db.club.create({
    data: {
      name: 'Thursday Readers',
      createdById: anu.id,
      memberships: {
        create: [
          { userId: anu.id, role: 'host', joinedAt: longAgo },
          { userId: rahul.id, role: 'member', joinedAt: longAgo },
          { userId: meera.id, role: 'member', joinedAt: longAgo },
        ],
      },
    },
  });

  const room = await db.room.create({
    data: {
      clubId: club.id,
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      chaptersConfirmedAt: longAgo,
      openedAt: longAgo,
      chapters: {
        create: [
          ...Array.from({ length: SEED_CHAPTERS }, (_, i) => ({
            position: i + 1,
            title: `Chapter ${i + 1}`,
          })),
          { position: SEED_CHAPTERS + 1, title: 'After the book', kind: 'after_book' as const },
        ],
      },
    },
    include: { chapters: { orderBy: { position: 'asc' } } },
  });
  const chapterIds = room.chapters.map((c) => c.id);
  const chapterAt = (p: number) => chapterIds[p - 1]!;

  // Write posts as each reader walks through the book, then set final bookmarks.
  const posts: SeedResult['posts'] = [];
  const write = async (authorId: string, position: number, body: string) => {
    const p = await db.post.create({
      data: { roomId: room.id, chapterId: chapterAt(position), authorId, body },
    });
    posts.push({ id: p.id, position, authorId });
    return p;
  };
  for (const p of [1, 2, 3]) await write(meera.id, p, `Meera on chapter ${p}`);
  for (const p of [1, 3, 5, 8, 10]) await write(rahul.id, p, `Rahul on chapter ${p}`);
  for (const p of [2, 4, 6, 8, 10, 12, 15, 20])
    await write(anu.id, p, `Anu on chapter ${p} SPOILER-${p}`);
  await write(anu.id, SEED_CHAPTERS + 1, 'Anu after the book: the ending SPOILER-END');

  const replies: SeedResult['replies'] = [];
  for (const post of posts.filter((p) => p.authorId === anu.id && p.position <= 10)) {
    const replier = post.position <= 3 ? meera.id : rahul.id;
    const r = await db.reply.create({
      data: { postId: post.id, authorId: replier, body: `Reply at ${post.position}` },
    });
    replies.push({ id: r.id, postId: post.id, position: post.position });
    await db.like.create({ data: { postId: post.id, userId: replier } });
  }
  // A like by Anu on a chapter-12 post of her own is fine; a like by Rahul on chapter 15 would be impossible.

  await db.bookmark.createMany({
    data: [
      { userId: meera.id, roomId: room.id, position: 3, joinedAt: longAgo, movedAt: longAgo },
      { userId: rahul.id, roomId: room.id, position: 10, joinedAt: longAgo, movedAt: longAgo },
      {
        userId: anu.id,
        roomId: room.id,
        position: SEED_CHAPTERS,
        finished: true,
        joinedAt: longAgo,
        movedAt: longAgo,
      },
    ],
  });
  await db.review.create({
    data: {
      roomId: room.id,
      userId: anu.id,
      rating: 4,
      body: 'Loved it. SPOILER-REVIEW the proposal scene.',
    },
  });

  return {
    clubId: club.id,
    roomId: room.id,
    chapterIds,
    users: { meera: meera.id, rahul: rahul.id, anu: anu.id, outsider: outsider.id },
    posts,
    replies,
  };
}
