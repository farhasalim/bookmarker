import type { Tx } from '@bookmarker/db';
import type { Viewer } from './rules.ts';

export interface RoomAccess {
  viewer: Viewer;
  clubId: string;
  isHost: boolean;
  positionHidden: boolean;
  chaptersConfirmed: boolean;
  /** Position of the "After the book" section = chapter count + 1. */
  afterBookPosition: number;
}

/**
 * Loads who is looking and how far they have read, in the caller's transaction.
 * Returns null when the user is not a member of the room's club, so callers
 * answer 404 and never confirm the room exists (SEC-4, SEC-5).
 *
 * Callers that read content must call this inside the SAME transaction as the
 * content query, so a bookmark can't move between the check and the read.
 */
export async function loadRoomAccess(
  tx: Tx,
  userId: string,
  roomId: string,
): Promise<RoomAccess | null> {
  const room = await tx.room.findUnique({
    where: { id: roomId },
    select: {
      clubId: true,
      chaptersConfirmedAt: true,
      chapters: { where: { kind: 'after_book' }, select: { position: true } },
      club: {
        select: {
          memberships: {
            where: { userId, user: { deletedAt: null } },
            select: { role: true, positionHidden: true },
          },
        },
      },
      bookmarks: { where: { userId }, select: { position: true, finished: true } },
    },
  });
  const membership = room?.club.memberships[0];
  if (!room || !membership) return null;

  const bookmark = room.bookmarks[0] ?? { position: 0, finished: false };
  return {
    viewer: { userId, roomId, position: bookmark.position, finished: bookmark.finished },
    clubId: room.clubId,
    isHost: membership.role === 'host',
    positionHidden: membership.positionHidden,
    chaptersConfirmed: room.chaptersConfirmedAt !== null,
    afterBookPosition: room.chapters[0]?.position ?? 1,
  };
}
