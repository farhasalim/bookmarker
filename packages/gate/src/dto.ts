import type { PostDTO, ReplyDTO, UserSummary } from '@bookmarker/shared';
import type { Prisma } from '@bookmarker/db';
import type { Viewer } from './rules.ts';

export const authorSelect = {
  select: { id: true, name: true, avatarUrl: true, deletedAt: true },
} as const;

type AuthorRow = { id: string; name: string; avatarUrl: string | null; deletedAt: Date | null };

/** Deleted accounts show as "Former member" (SEC-11). */
export function toUserSummary(u: AuthorRow): UserSummary {
  return u.deletedAt
    ? { id: u.id, name: 'Former member', avatarUrl: null }
    : { id: u.id, name: u.name, avatarUrl: u.avatarUrl };
}

/** Columns needed to build a PostDTO for `viewerId`. */
export function postInclude(viewerId: string) {
  return {
    author: authorSelect,
    chapter: { select: { position: true } },
    likes: { where: { userId: viewerId }, select: { userId: true } },
    _count: { select: { likes: true, replies: { where: { deletedAt: null } } } },
  } satisfies Prisma.PostInclude;
}

export type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;

export function toPostDTO(row: PostRow, viewer: Pick<Viewer, 'userId'>): PostDTO {
  return {
    id: row.id,
    chapterId: row.chapterId,
    position: row.chapter.position,
    author: toUserSummary(row.author),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    likeCount: row._count.likes,
    likedByMe: row.likes.length > 0,
    replyCount: row._count.replies,
    mine: row.authorId === viewer.userId,
  };
}

export const replyInclude = { author: authorSelect } satisfies Prisma.ReplyInclude;
export type ReplyRow = Prisma.ReplyGetPayload<{ include: typeof replyInclude }>;

export function toReplyDTO(row: ReplyRow, viewer: Pick<Viewer, 'userId'>): ReplyDTO {
  return {
    id: row.id,
    postId: row.postId,
    author: toUserSummary(row.author),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    mine: row.authorId === viewer.userId,
  };
}
