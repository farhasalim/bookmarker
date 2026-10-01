import type { Tx } from '@bookmarker/db';
import type { Viewer } from './rules.ts';
import { canSeePost } from './rules.ts';

/**
 * Who may be told about a post RIGHT NOW (FR-12, gate rule 9).
 * Readers in the room whose bookmark has reached the post's chapter, or who are
 * Finished; current club members only; never the author.
 *
 * Call this at SEND time, not when the post was written. The worker calls it again
 * per recipient before every in-app or email notification goes out.
 */
export async function postAudience(tx: Tx, postId: string): Promise<Viewer[]> {
  const post = await tx.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: {
      roomId: true,
      authorId: true,
      chapter: { select: { position: true } },
      room: { select: { clubId: true } },
    },
  });
  if (!post) return [];
  const bookmarks = await tx.bookmark.findMany({
    where: {
      roomId: post.roomId,
      userId: { not: post.authorId },
      user: {
        deletedAt: null,
        memberships: { some: { clubId: post.room.clubId } },
      },
      OR: [{ finished: true }, { position: { gte: post.chapter.position } }],
    },
    select: { userId: true, position: true, finished: true },
  });
  // Belt and braces: re-apply the pure rule to whatever the query returned.
  return bookmarks
    .map((b) => ({ userId: b.userId, roomId: post.roomId, position: b.position, finished: b.finished }))
    .filter((v) => canSeePost(v, { authorId: post.authorId, chapterPosition: post.chapter.position }));
}

/**
 * Re-check one recipient for one post at send time. Returns false if the post was
 * deleted, the reader left the club, or (somehow) they are not at its chapter.
 */
export async function mayNotifyAboutPost(tx: Tx, userId: string, postId: string): Promise<boolean> {
  const audience = await postAudience(tx, postId);
  return audience.some((v) => v.userId === userId);
}
