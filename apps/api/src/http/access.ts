import type { Tx } from '@bookmarker/db';
import { loadRoomAccess, type RoomAccess } from '@bookmarker/gate';
import { HttpError, notFound } from './errors.ts';

/** Room access or 404 (SEC-4): non-members never learn the room exists. */
export async function requireRoomAccess(tx: Tx, userId: string, roomId: string): Promise<RoomAccess> {
  const access = await loadRoomAccess(tx, userId, roomId);
  if (!access) throw notFound();
  return access;
}

export async function requireMember(tx: Tx, userId: string, clubId: string) {
  const m = await tx.membership.findUnique({
    where: { clubId_userId: { clubId, userId } },
    select: { role: true, positionHidden: true, joinedAt: true },
  });
  if (!m) throw notFound();
  return m;
}

export async function requireHost(tx: Tx, userId: string, clubId: string) {
  const m = await requireMember(tx, userId, clubId);
  if (m.role !== 'host') throw new HttpError(403, 'FORBIDDEN', 'Only a host can do that');
  return m;
}

export function requireHostAccess(access: RoomAccess): void {
  if (!access.isHost) throw new HttpError(403, 'FORBIDDEN', 'Only a host can do that');
}
