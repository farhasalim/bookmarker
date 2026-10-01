import type { Prisma } from '@bookmarker/db';
import type { Viewer } from './rules.ts';

/**
 * The gate as a Prisma filter. This is the ONLY place a "which posts" filter is
 * built. Every list, count, unlock, reply and like query composes it.
 *
 * Mirrors rules.canSeePost exactly:
 *   not deleted AND in this room AND (written by viewer OR chapter.position <= bookmark)
 * Finished readers see the whole room.
 */
export function visiblePostsWhere(viewer: Viewer): Prisma.PostWhereInput {
  const base: Prisma.PostWhereInput = { roomId: viewer.roomId, deletedAt: null };
  if (viewer.finished) return base;
  return {
    ...base,
    OR: [{ authorId: viewer.userId }, { chapter: { position: { lte: viewer.position } } }],
  };
}

/** The complement used for "n thoughts waiting": counts only, never content. */
export function waitingPostsWhere(viewer: Viewer): Prisma.PostWhereInput {
  if (viewer.finished) return { id: { in: [] } };
  return {
    roomId: viewer.roomId,
    deletedAt: null,
    authorId: { not: viewer.userId },
    chapter: { position: { gt: viewer.position } },
  };
}
