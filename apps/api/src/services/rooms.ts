import type { Tx } from '@bookmarker/db';
import { chapterCounts, highestPostedPosition, type RoomAccess } from '@bookmarker/gate';
import type { ChapterDTO, FriendPosition, RoomDTO } from '@bookmarker/shared';
import { HttpError } from '../http/errors.ts';

/**
 * Chapters at or below this position can no longer be added, removed or reordered
 * (decision #11): the highest chapter any reader has reached or anyone has posted at.
 * Bookmarks store a position, so shifting a chapter under a reader would silently
 * change what they can see. Renaming is always allowed.
 */
export async function frozenThrough(tx: Tx, roomId: string): Promise<number> {
  const top = await tx.bookmark.aggregate({
    where: { roomId, finished: false },
    _max: { position: true },
  });
  const chapterCount = await tx.chapter.count({ where: { roomId, kind: 'chapter' } });
  const posted = await highestPostedPosition(tx, roomId);
  const anyFinished = await tx.bookmark.count({ where: { roomId, finished: true } });
  const reached = Math.max(top._max.position ?? 0, anyFinished > 0 ? chapterCount : 0);
  return Math.min(Math.max(reached, posted), chapterCount);
}

export async function buildRoomDTO(tx: Tx, access: RoomAccess): Promise<RoomDTO> {
  const { viewer } = access;
  const room = await tx.room.findUniqueOrThrow({
    where: { id: viewer.roomId },
    include: {
      club: { select: { name: true } },
      chapters: { orderBy: { position: 'asc' } },
      bookmarks: {
        where: {
          userId: { not: viewer.userId },
          user: {
            deletedAt: null,
            memberships: { some: { clubId: access.clubId, positionHidden: false } },
          },
        },
        select: { userId: true, position: true, finished: true, user: { select: { name: true } } },
        orderBy: { position: 'desc' },
      },
    },
  });
  const { visible, waiting } = await chapterCounts(tx, viewer);
  const chapters: ChapterDTO[] = room.chapters.map((c) => {
    const unlocked = viewer.finished || (c.kind === 'chapter' && c.position <= viewer.position);
    return {
      id: c.id,
      position: c.position,
      title: c.title,
      kind: c.kind,
      unlocked,
      // Locked chapters show only "n thoughts waiting" by others (FR-9).
      count: unlocked ? (visible.get(c.id) ?? 0) : (waiting.get(c.id) ?? 0),
    };
  });
  const friends: FriendPosition[] = room.bookmarks.map((b) => ({
    userId: b.userId,
    name: b.user.name,
    position: b.position,
    finished: b.finished,
  }));
  return {
    id: room.id,
    clubId: room.clubId,
    clubName: room.club.name,
    title: room.title,
    author: room.author,
    coverUrl: room.coverUrl,
    status: room.status,
    chaptersConfirmed: room.chaptersConfirmedAt !== null,
    chapterCount: room.chapters.filter((c) => c.kind === 'chapter').length,
    me: { position: viewer.position, finished: viewer.finished, isHost: access.isHost },
    chapters,
    friends,
    frozenThrough: room.chaptersConfirmedAt ? await frozenThrough(tx, room.id) : 0,
    seq: room.eventSeq,
  };
}

/**
 * Replace a room's chapter list (FR-5 + decision #11). Positions are renumbered
 * 1..N in the order given, with "After the book" kept at N+1.
 */
export async function replaceChapters(
  tx: Tx,
  roomId: string,
  incoming: Array<{ id?: string | undefined; title: string }>,
  confirm: boolean,
  now: Date,
): Promise<void> {
  const room = await tx.room.findUniqueOrThrow({
    where: { id: roomId },
    select: { chaptersConfirmedAt: true, chapters: { orderBy: { position: 'asc' } } },
  });
  const existing = room.chapters.filter((c) => c.kind === 'chapter');
  const afterBook = room.chapters.find((c) => c.kind === 'after_book');
  const existingIds = new Set(existing.map((c) => c.id));
  for (const c of incoming) {
    if (c.id && !existingIds.has(c.id))
      throw new HttpError(400, 'VALIDATION', 'Unknown chapter id');
  }
  if (
    new Set(incoming.filter((c) => c.id).map((c) => c.id)).size !==
    incoming.filter((c) => c.id).length
  ) {
    throw new HttpError(400, 'VALIDATION', 'A chapter appears twice');
  }

  if (room.chaptersConfirmedAt) {
    const frozen = await frozenThrough(tx, roomId);
    for (let i = 0; i < frozen; i++) {
      if (incoming[i]?.id !== existing[i]!.id) {
        throw new HttpError(
          409,
          'CHAPTERS_LOCKED',
          `Chapters 1–${frozen} are fixed because readers have reached them. You can rename them, or change chapters after ${frozen}.`,
        );
      }
    }
  }

  // Move everything out of the way first so the (room_id, position) unique index never clashes.
  const OFFSET = 100_000;
  await tx.chapter.updateMany({ where: { roomId }, data: { position: { increment: OFFSET } } });

  const keep = new Set(incoming.filter((c) => c.id).map((c) => c.id!));
  const removed = existing.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (removed.length) await tx.chapter.deleteMany({ where: { id: { in: removed } } });

  for (const [i, c] of incoming.entries()) {
    if (c.id) {
      await tx.chapter.update({ where: { id: c.id }, data: { position: i + 1, title: c.title } });
    } else {
      await tx.chapter.create({ data: { roomId, position: i + 1, title: c.title } });
    }
  }
  const afterPos = incoming.length + 1;
  if (afterBook) {
    await tx.chapter.update({ where: { id: afterBook.id }, data: { position: afterPos } });
  } else {
    await tx.chapter.create({
      data: { roomId, position: afterPos, title: 'After the book', kind: 'after_book' },
    });
  }
  if (confirm && !room.chaptersConfirmedAt) {
    await tx.room.update({ where: { id: roomId }, data: { chaptersConfirmedAt: now } });
  }
}
