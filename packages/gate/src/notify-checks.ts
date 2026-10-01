import type { Tx } from '@bookmarker/db';
import { canSeePost } from './rules.ts';

/**
 * Send-time re-check for ANY notification about a post (gate rule 9): the post
 * still exists, the user is still a member of its club, and the gate lets them
 * see it right now. Used by the worker immediately before delivering.
 */
export async function canSeePostNow(tx: Tx, userId: string, postId: string): Promise<boolean> {
  const post = await tx.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: {
      authorId: true,
      roomId: true,
      chapter: { select: { position: true } },
      room: { select: { clubId: true } },
    },
  });
  if (!post) return false;
  const member = await tx.membership.findFirst({
    where: { clubId: post.room.clubId, userId, user: { deletedAt: null } },
    select: { userId: true },
  });
  if (!member) return false;
  const b = await tx.bookmark.findUnique({
    where: { userId_roomId: { userId, roomId: post.roomId } },
    select: { position: true, finished: true },
  });
  const viewer = { userId, position: b?.position ?? 0, finished: b?.finished ?? false };
  return canSeePost(viewer, { authorId: post.authorId, chapterPosition: post.chapter.position });
}
