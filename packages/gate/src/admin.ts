import type { Tx } from '@bookmarker/db';
import { canSeePost } from './rules.ts';
import type { RoomAccess } from './viewer.ts';

/**
 * Which room a post belongs to, without revealing anything about it. Routes use
 * this to load the caller's RoomAccess before asking the gate for the post itself.
 */
export async function locatePost(tx: Tx, postId: string): Promise<{ roomId: string } | null> {
  return tx.post.findFirst({ where: { id: postId, deletedAt: null }, select: { roomId: true } });
}

export interface ReportItem {
  reportId: string;
  /** Null when the post is beyond the host's bookmark: act on it via reportId instead. */
  postId: string | null;
  roomId: string;
  position: number;
  reportCount: number;
  reason: string | null;
  createdAt: string;
  /** Post text, only if the host's own bookmark lets them see it. */
  body: string | null;
  authorName: string | null;
}

/**
 * Open reports for a host's club (FR-19). Hosts are gated like everyone else
 * (PRD rule 5): a report about a post beyond their bookmark shows the chapter
 * number only. They can still delete it without reading it.
 */
export async function openReports(
  tx: Tx,
  accessByRoom: Map<string, RoomAccess>,
): Promise<ReportItem[]> {
  const roomIds = [...accessByRoom.keys()];
  if (roomIds.length === 0) return [];
  const reports = await tx.report.findMany({
    where: { resolvedAt: null, post: { roomId: { in: roomIds }, deletedAt: null } },
    include: {
      post: {
        select: {
          id: true,
          roomId: true,
          authorId: true,
          body: true,
          chapter: { select: { position: true } },
          author: { select: { name: true, deletedAt: true } },
          _count: { select: { reports: { where: { resolvedAt: null } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const seen = new Set<string>();
  const out: ReportItem[] = [];
  for (const r of reports) {
    if (seen.has(r.postId)) continue;
    seen.add(r.postId);
    const access = accessByRoom.get(r.post.roomId)!;
    const visible = canSeePost(access.viewer, {
      authorId: r.post.authorId,
      chapterPosition: r.post.chapter.position,
    });
    out.push({
      reportId: r.id,
      postId: visible ? r.postId : null,
      roomId: r.post.roomId,
      position: r.post.chapter.position,
      reportCount: r.post._count.reports,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      body: visible ? r.post.body : null,
      authorName: visible ? (r.post.author.deletedAt ? 'Former member' : r.post.author.name) : null,
    });
  }
  return out;
}

/** File a report on a post the reporter can see (404 otherwise). */
export async function fileReport(
  tx: Tx,
  access: RoomAccess,
  postId: string,
  reason: string | undefined,
): Promise<boolean> {
  const post = await tx.post.findFirst({
    where: { id: postId, roomId: access.viewer.roomId, deletedAt: null },
    select: { authorId: true, chapter: { select: { position: true } } },
  });
  if (
    !post ||
    !canSeePost(access.viewer, { authorId: post.authorId, chapterPosition: post.chapter.position })
  ) {
    return false;
  }
  await tx.report.upsert({
    where: { postId_reporterId: { postId, reporterId: access.viewer.userId } },
    create: { postId, reporterId: access.viewer.userId, reason: reason ?? null },
    update: { reason: reason ?? null, resolvedAt: null },
  });
  return true;
}

/** The post behind a report, for a blind delete by a host of that club. */
export async function postForReport(
  tx: Tx,
  reportId: string,
): Promise<{ postId: string; roomId: string } | null> {
  const r = await tx.report.findUnique({
    where: { id: reportId },
    select: { postId: true, post: { select: { roomId: true, deletedAt: true } } },
  });
  if (!r || r.post.deletedAt) return null;
  return { postId: r.postId, roomId: r.post.roomId };
}

export async function resolveReportsFor(
  tx: Tx,
  postId: string,
  byUserId: string,
  now: Date,
): Promise<void> {
  await tx.report.updateMany({
    where: { postId, resolvedAt: null },
    data: { resolvedAt: now, resolvedById: byUserId },
  });
}

/**
 * Data export (SEC-11): everything the user wrote. Their own content only, so it
 * cannot leak anyone else's spoilers.
 */
export async function ownContent(tx: Tx, userId: string) {
  // Sequential on purpose: a transaction is one connection; don't overlap queries on it.
  const posts = await tx.post.findMany({
    where: { authorId: userId },
    select: {
      id: true,
      body: true,
      createdAt: true,
      editedAt: true,
      deletedAt: true,
      room: { select: { title: true } },
      chapter: { select: { position: true, title: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const replies = await tx.reply.findMany({
    where: { authorId: userId },
    select: { id: true, postId: true, body: true, createdAt: true, deletedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const likes = await tx.like.findMany({
    where: { userId },
    select: { postId: true, createdAt: true },
  });
  const reviews = await tx.review.findMany({
    where: { userId },
    select: {
      rating: true,
      body: true,
      isPublic: true,
      createdAt: true,
      updatedAt: true,
      room: { select: { title: true } },
    },
  });
  return { posts, replies, likes, reviews };
}
