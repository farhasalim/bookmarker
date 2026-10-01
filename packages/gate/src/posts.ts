import type { PostDTO, ReplyDTO } from '@bookmarker/shared';
import type { Tx } from '@bookmarker/db';
import { GateError, notFound } from './errors.ts';
import { postInclude, replyInclude, toPostDTO, toReplyDTO } from './dto.ts';
import { canSeePost, postablePosition, type Viewer } from './rules.ts';
import type { RoomAccess } from './viewer.ts';
import { visiblePostsWhere, waitingPostsWhere } from './where.ts';

/* ------------------------------------------------------------------ reads */

/** Posts at one chapter that this viewer may see. Empty for a locked chapter. */
export async function listChapterPosts(
  tx: Tx,
  viewer: Viewer,
  chapterId: string,
  page: { cursor?: string; limit: number },
): Promise<{ posts: PostDTO[]; nextCursor: string | null }> {
  const rows = await tx.post.findMany({
    where: { AND: [visiblePostsWhere(viewer), { chapterId }] },
    include: postInclude(viewer.userId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > page.limit;
  const slice = more ? rows.slice(0, page.limit) : rows;
  return {
    posts: slice.map((r) => toPostDTO(r, viewer)),
    nextCursor: more ? (slice.at(-1)?.id ?? null) : null,
  };
}

/** One post, or 404 if it doesn't exist OR the viewer may not see it (SEC-5, AT-2). */
export async function getVisiblePost(tx: Tx, viewer: Viewer, postId: string): Promise<PostDTO> {
  const row = await tx.post.findFirst({
    where: { AND: [visiblePostsWhere(viewer), { id: postId }] },
    include: postInclude(viewer.userId),
  });
  if (!row) throw notFound();
  return toPostDTO(row, viewer);
}

/** Posts in positions (above, through] — the payload of an unlock event (gate rule 6). */
export async function postsUnlockedBetween(
  tx: Tx,
  viewer: Viewer,
  above: number,
  through: number,
): Promise<PostDTO[]> {
  const positionFilter =
    through === Number.POSITIVE_INFINITY ? { gt: above } : { gt: above, lte: through };
  const rows = await tx.post.findMany({
    where: {
      AND: [
        visiblePostsWhere(viewer),
        { authorId: { not: viewer.userId } }, // own posts were never locked
        { chapter: { position: positionFilter } },
      ],
    },
    include: postInclude(viewer.userId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => toPostDTO(r, viewer));
}

/**
 * Per-chapter counts for the room's contents list (FR-9):
 * visible count for unlocked chapters, "waiting" count (no content) for locked ones.
 */
export async function chapterCounts(
  tx: Tx,
  viewer: Viewer,
): Promise<{ visible: Map<string, number>; waiting: Map<string, number> }> {
  const [visible, waiting] = await Promise.all([
    tx.post.groupBy({ by: ['chapterId'], where: visiblePostsWhere(viewer), _count: { _all: true } }),
    tx.post.groupBy({ by: ['chapterId'], where: waitingPostsWhere(viewer), _count: { _all: true } }),
  ]);
  return {
    visible: new Map(visible.map((g) => [g.chapterId, g._count._all])),
    waiting: new Map(waiting.map((g) => [g.chapterId, g._count._all])),
  };
}

/** Waiting count for one chapter, for a viewer below it (socket waiting:count). */
export async function waitingCountAt(tx: Tx, viewer: Viewer, chapterId: string): Promise<number> {
  return tx.post.count({ where: { AND: [waitingPostsWhere(viewer), { chapterId }] } });
}

/** Highest chapter position that has any post (for the chapter-lock rule). */
export async function highestPostedPosition(tx: Tx, roomId: string): Promise<number> {
  const top = await tx.post.findFirst({
    where: { roomId },
    orderBy: { chapter: { position: 'desc' } },
    select: { chapter: { select: { position: true } } },
  });
  return top?.chapter.position ?? 0;
}

/* ------------------------------------------------------------------ writes */

/**
 * Create a post at the viewer's bookmark (FR-7). Any other chapter is rejected with
 * 403 NOT_AT_BOOKMARK — including chapters the viewer can see but has passed (L-3 is v1.1).
 */
export async function createPost(
  tx: Tx,
  access: RoomAccess,
  chapterId: string,
  body: string,
): Promise<PostDTO> {
  const { viewer } = access;
  if (!access.chaptersConfirmed) {
    throw new GateError(409, 'CHAPTERS_NOT_CONFIRMED', 'The host has not confirmed the chapter list yet');
  }
  const chapter = await tx.chapter.findFirst({
    where: { id: chapterId, roomId: viewer.roomId },
    select: { id: true, position: true },
  });
  if (!chapter) throw notFound();
  if (chapter.position !== postablePosition(viewer, access.afterBookPosition)) {
    throw new GateError(403, 'NOT_AT_BOOKMARK', 'You can only post at the chapter your bookmark is on');
  }
  const row = await tx.post.create({
    data: { roomId: viewer.roomId, chapterId, authorId: viewer.userId, body },
    include: postInclude(viewer.userId),
  });
  return toPostDTO(row, viewer);
}

export async function editOwnPost(tx: Tx, viewer: Viewer, postId: string, body: string): Promise<PostDTO> {
  const existing = await tx.post.findFirst({
    where: { id: postId, roomId: viewer.roomId, authorId: viewer.userId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) throw notFound();
  const row = await tx.post.update({
    where: { id: postId },
    data: { body, editedAt: new Date() },
    include: postInclude(viewer.userId),
  });
  return toPostDTO(row, viewer);
}

/** Author deletes their own post, or a host deletes any post in their club (FR-19). */
export async function softDeletePost(
  tx: Tx,
  access: RoomAccess,
  postId: string,
): Promise<{ chapterId: string; position: number; authorId: string }> {
  const post = await tx.post.findFirst({
    where: { id: postId, roomId: access.viewer.roomId, deletedAt: null },
    select: { authorId: true, chapterId: true, chapter: { select: { position: true } } },
  });
  // Hosts may delete blind (without reading) a post above their bookmark, e.g. from a report.
  const allowed = post && (access.isHost || post.authorId === access.viewer.userId);
  if (!post || !allowed) throw notFound();
  await tx.post.update({
    where: { id: postId },
    data: { deletedAt: new Date(), deletedById: access.viewer.userId },
  });
  return { chapterId: post.chapterId, position: post.chapter.position, authorId: post.authorId };
}

/* --------------------------------------------------------- replies & likes */

/** Loads the post only if visible; replies and likes inherit its gate (SRS section 4). */
async function requireVisiblePost(tx: Tx, viewer: Viewer, postId: string) {
  const post = await tx.post.findFirst({
    where: { AND: [visiblePostsWhere(viewer), { id: postId }] },
    select: { id: true, authorId: true, chapterId: true, chapter: { select: { position: true } } },
  });
  if (!post) throw notFound();
  return post;
}

export async function listReplies(tx: Tx, viewer: Viewer, postId: string): Promise<ReplyDTO[]> {
  await requireVisiblePost(tx, viewer, postId);
  const rows = await tx.reply.findMany({
    where: { postId, deletedAt: null },
    include: replyInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 200,
  });
  return rows.map((r) => toReplyDTO(r, viewer));
}

export async function createReply(
  tx: Tx,
  viewer: Viewer,
  postId: string,
  body: string,
): Promise<{ reply: ReplyDTO; postAuthorId: string; position: number }> {
  const post = await requireVisiblePost(tx, viewer, postId);
  const row = await tx.reply.create({
    data: { postId, authorId: viewer.userId, body },
    include: replyInclude,
  });
  return { reply: toReplyDTO(row, viewer), postAuthorId: post.authorId, position: post.chapter.position };
}

export async function setLike(
  tx: Tx,
  viewer: Viewer,
  postId: string,
  liked: boolean,
): Promise<{ count: number; position: number; authorId: string }> {
  const post = await requireVisiblePost(tx, viewer, postId);
  if (liked) {
    await tx.like.upsert({
      where: { postId_userId: { postId, userId: viewer.userId } },
      create: { postId, userId: viewer.userId },
      update: {},
    });
  } else {
    await tx.like.deleteMany({ where: { postId, userId: viewer.userId } });
  }
  const count = await tx.like.count({ where: { postId } });
  return { count, position: post.chapter.position, authorId: post.authorId };
}

/** Re-check, at send time, whether `viewer` may see `postId` (notifications, sockets). */
export function viewerCanSee(viewer: Viewer, post: { authorId: string; position: number }): boolean {
  return canSeePost(viewer, { authorId: post.authorId, chapterPosition: post.position });
}
