import type { ReviewDTO } from '@bookmarker/shared';
import { LIMITS } from '@bookmarker/shared';
import type { Tx } from '@bookmarker/db';
import { authorSelect, toUserSummary } from './dto.ts';
import { GateError } from './errors.ts';
import { canSeeRoomReviews, type Viewer } from './rules.ts';

const reviewInclude = { user: authorSelect } as const;

/**
 * Reviews in a room: only for readers who have finished (FR-16, AT-11).
 * Public reviews are still hidden here for non-finishers; their only public
 * surface is the writer's profile/share card, behind a spoiler reveal.
 */
export async function listRoomReviews(tx: Tx, viewer: Viewer): Promise<ReviewDTO[]> {
  if (!canSeeRoomReviews(viewer)) {
    throw new GateError(403, 'NOT_FINISHED', 'Reviews unlock when you finish the book');
  }
  const rows = await tx.review.findMany({
    where: { roomId: viewer.roomId },
    include: reviewInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => ({
    user: toUserSummary(r.user),
    rating: r.rating,
    body: r.body,
    isPublic: r.isPublic,
    updatedAt: r.updatedAt.toISOString(),
    mine: r.userId === viewer.userId,
  }));
}

export async function getMyReview(tx: Tx, viewer: Viewer): Promise<ReviewDTO | null> {
  const r = await tx.review.findUnique({
    where: { roomId_userId: { roomId: viewer.roomId, userId: viewer.userId } },
    include: reviewInclude,
  });
  return r
    ? {
        user: toUserSummary(r.user),
        rating: r.rating,
        body: r.body,
        isPublic: r.isPublic,
        updatedAt: r.updatedAt.toISOString(),
        mine: true,
      }
    : null;
}

export interface StarOutcome {
  review: ReviewDTO;
  starsAwarded: Array<'rated' | 'reviewed'>;
}

/**
 * Rate and optionally review (FR-15) and award stars (FR-17):
 *  +1 the first time a finished reader rates this room,
 *  +1 the first time the review body has 50+ characters,
 *  never twice per room (unique star_events row), and only after 3 days of membership.
 */
export async function upsertReview(
  tx: Tx,
  viewer: Viewer,
  input: { rating: number; body?: string | undefined; isPublic: boolean },
  now = new Date(),
): Promise<StarOutcome> {
  if (!viewer.finished) {
    throw new GateError(403, 'NOT_FINISHED', 'Mark the book Finished before rating it');
  }
  const body = input.body && input.body.length > 0 ? input.body : null;
  const r = await tx.review.upsert({
    where: { roomId_userId: { roomId: viewer.roomId, userId: viewer.userId } },
    create: { roomId: viewer.roomId, userId: viewer.userId, rating: input.rating, body, isPublic: input.isPublic },
    update: { rating: input.rating, body, isPublic: input.isPublic },
    include: reviewInclude,
  });

  const bookmark = await tx.bookmark.findUnique({
    where: { userId_roomId: { userId: viewer.userId, roomId: viewer.roomId } },
    select: { joinedAt: true },
  });
  const eligible =
    bookmark !== null && now.getTime() - bookmark.joinedAt.getTime() >= 3 * 24 * 60 * 60 * 1000;

  const starsAwarded: StarOutcome['starsAwarded'] = [];
  if (eligible) {
    const reasons: Array<'rated' | 'reviewed'> = ['rated'];
    if (body && body.length >= LIMITS.reviewStarMinChars) reasons.push('reviewed');
    for (const reason of reasons) {
      const res = await tx.starEvent.createMany({
        data: [{ userId: viewer.userId, roomId: viewer.roomId, reason }],
        skipDuplicates: true,
      });
      if (res.count > 0) starsAwarded.push(reason);
    }
    if (starsAwarded.length > 0) {
      await tx.user.update({
        where: { id: viewer.userId },
        data: { starTotal: { increment: starsAwarded.length } },
      });
    }
  }

  return {
    review: {
      user: toUserSummary(r.user),
      rating: r.rating,
      body: r.body,
      isPublic: r.isPublic,
      updatedAt: r.updatedAt.toISOString(),
      mine: true,
    },
    starsAwarded,
  };
}

export interface ProfileBook {
  roomId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  /** null when the viewer may not see it (decision: ratings only to fellow finishers, or public). */
  rating: number | null;
  review: { body: string; spoilerGuarded: boolean } | null;
  stars: number;
}

/**
 * A profile's finished books as seen by `viewerId` (FR-18 + the review decision):
 * - rating and review text are shown when the viewer has also finished that room,
 *   or when the writer made the review public;
 * - public reviews shown to a non-finisher are flagged spoilerGuarded so the UI
 *   puts them behind "May contain spoilers".
 * Only club-mates (or the user themself) may view a profile; the API checks that.
 */
export async function profileBooks(tx: Tx, profileUserId: string, viewerId: string): Promise<ProfileBook[]> {
  const finished = await tx.bookmark.findMany({
    where: { userId: profileUserId, finished: true },
    select: {
      roomId: true,
      room: { select: { title: true, author: true, coverUrl: true } },
    },
    orderBy: { movedAt: 'desc' },
  });
  if (finished.length === 0) return [];
  const roomIds = finished.map((f) => f.roomId);
  const [reviews, viewerFinished, stars] = await Promise.all([
    tx.review.findMany({ where: { userId: profileUserId, roomId: { in: roomIds } } }),
    tx.bookmark.findMany({
      where: { userId: viewerId, roomId: { in: roomIds }, finished: true },
      select: { roomId: true },
    }),
    tx.starEvent.groupBy({
      by: ['roomId'],
      where: { userId: profileUserId, roomId: { in: roomIds } },
      _count: { _all: true },
    }),
  ]);
  const reviewBy = new Map(reviews.map((r) => [r.roomId, r]));
  const viewerDone = new Set(viewerFinished.map((b) => b.roomId));
  const starsBy = new Map(stars.map((s) => [s.roomId, s._count._all]));
  const self = profileUserId === viewerId;

  return finished.map((f) => {
    const r = reviewBy.get(f.roomId);
    const insider = self || viewerDone.has(f.roomId);
    const showRating = !!r && (insider || r.isPublic);
    const showBody = !!r?.body && (insider || r.isPublic);
    return {
      roomId: f.roomId,
      title: f.room.title,
      author: f.room.author,
      coverUrl: f.room.coverUrl,
      rating: showRating ? r!.rating : null,
      review: showBody ? { body: r!.body!, spoilerGuarded: !insider } : null,
      stars: starsBy.get(f.roomId) ?? 0,
    };
  });
}
