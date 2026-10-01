/**
 * THE SPOILER RULE, as pure functions.
 *
 *   A post is visible to a reader, and may notify them, only if its chapter
 *   position is at or below that reader's bookmark, or they wrote it.
 *   A Finished reader's bookmark counts as infinity.
 *
 * Everything else in this package (queries, recipients, counts) is built on
 * these few lines. Keep them boring.
 */

export interface Viewer {
  userId: string;
  roomId: string;
  /** Last chapter finished, 0 = not started. */
  position: number;
  finished: boolean;
}

/** Infinity for Finished readers, otherwise their bookmark position. */
export function reach(viewer: Pick<Viewer, 'position' | 'finished'>): number {
  return viewer.finished ? Number.POSITIVE_INFINITY : viewer.position;
}

/** Can this viewer see content tagged to `chapterPosition`? (ignores authorship) */
export function positionVisible(
  viewer: Pick<Viewer, 'position' | 'finished'>,
  chapterPosition: number,
): boolean {
  return chapterPosition <= reach(viewer);
}

/** The full gate for one post. Replies and likes inherit it from their post. */
export function canSeePost(
  viewer: Pick<Viewer, 'userId' | 'position' | 'finished'>,
  post: { authorId: string; chapterPosition: number },
): boolean {
  return post.authorId === viewer.userId || positionVisible(viewer, post.chapterPosition);
}

/** Reviews and ratings use a stricter gate: only Finished readers (SRS section 4). */
export function canSeeRoomReviews(viewer: Pick<Viewer, 'finished'>): boolean {
  return viewer.finished;
}

/**
 * The one chapter a reader may post at (FR-7): the chapter equal to their bookmark,
 * or the "After the book" section once Finished. Position 0 has no chapter.
 */
export function postablePosition(
  viewer: Pick<Viewer, 'position' | 'finished'>,
  afterBookPosition: number,
): number | null {
  if (viewer.finished) return afterBookPosition;
  return viewer.position >= 1 ? viewer.position : null;
}

/**
 * Which positions a bookmark move unlocks: the half-open range (from, to].
 * Returns null when nothing new becomes visible (moving back, or not moving).
 */
export function unlockedRange(
  before: Pick<Viewer, 'position' | 'finished'>,
  after: Pick<Viewer, 'position' | 'finished'>,
): { above: number; through: number } | null {
  const a = reach(before);
  const b = reach(after);
  return b > a ? { above: a, through: b } : null;
}
