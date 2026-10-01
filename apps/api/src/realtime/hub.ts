import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { parse as parseCookie } from 'cookie';
import type { Db } from '@bookmarker/db';
import {
  canSeePost,
  getVisiblePost,
  getVisibleReply,
  loadRoomAccess,
  postsUnlockedBetween,
  unlockedRange,
  waitingCountAt,
  type Viewer,
} from '@bookmarker/gate';
import type { ClientToServerEvents, ServerToClientEvents } from '@bookmarker/shared';
import type { Logger } from 'pino';
import { SESSION_COOKIE, userFromToken } from '../auth/sessions.ts';
import type { EventBus, RoomEvent } from './bus.ts';

export type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
interface SocketData {
  userId: string;
  /** Cached bookmark per joined room. Checked before EVERY emit (SRS section 7). */
  viewers: Map<string, Viewer>;
}

const REPLAY_MAX = 500;

export function createIO(http: HttpServer, appOrigin: string): IO {
  return new Server(http, { cors: { origin: [appOrigin], credentials: true }, serveClient: false });
}

/**
 * Real-time delivery (FR-11). Every event is filtered per socket by the gate,
 * using that socket's cached bookmark. Events arrive as ids; content is loaded
 * through @bookmarker/gate for each socket that may see it.
 */
export function attachRealtime(
  io: IO,
  db: Db,
  bus: EventBus,
  allowedOrigins: string[],
  logger: Logger,
) {
  // Authenticate with the session cookie and check Origin (SEC-8).
  io.use(async (socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (!origin || !allowedOrigins.includes(origin)) return next(new Error('origin'));
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const found = await userFromToken(db, cookies[SESSION_COOKIE]).catch(() => null);
    if (!found) return next(new Error('unauthenticated'));
    socket.data.userId = found.user.id;
    socket.data.viewers = new Map();
    next();
  });

  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId}`);

    socket.on('room:join', async ({ roomId, lastSeq }, ack) => {
      try {
        const access = await loadRoomAccess(db, socket.data.userId, String(roomId));
        if (!access) return ack?.({ ok: false });
        socket.data.viewers.set(roomId, access.viewer);
        await socket.join(`room:${roomId}`);
        const room = await db.room.findUniqueOrThrow({
          where: { id: roomId },
          select: { eventSeq: true },
        });
        if (typeof lastSeq === 'number' && lastSeq < room.eventSeq) {
          const missed = await db.roomEvent.findMany({
            where: { roomId, seq: { gt: lastSeq } },
            orderBy: { seq: 'asc' },
            take: REPLAY_MAX,
          });
          for (const row of missed) {
            const e = {
              ...(row.payload as object),
              type: row.type,
              roomId,
              seq: row.seq,
            } as RoomEvent;
            await deliver(e, [socket], { replay: true });
          }
          socket.emit('room:replay-done', { roomId, seq: room.eventSeq });
        }
        ack?.({ ok: true, seq: room.eventSeq });
      } catch (err) {
        logger.warn({ err }, 'room:join failed');
        ack?.({ ok: false });
      }
    });

    socket.on('room:leave', ({ roomId }) => {
      socket.data.viewers.delete(roomId);
      void socket.leave(`room:${roomId}`);
    });
  });

  async function localSockets(roomId: string): Promise<S[]> {
    const ids = io.of('/').adapter.rooms.get(`room:${roomId}`);
    if (!ids) return [];
    return [...ids].map((id) => io.of('/').sockets.get(id)).filter((s): s is S => !!s);
  }

  async function deliver(e: RoomEvent, targets: S[], opts: { replay?: boolean } = {}) {
    for (const socket of targets) {
      const viewer = socket.data.viewers.get(e.roomId);
      if (!viewer) continue;
      try {
        await deliverOne(e, socket, viewer, opts);
      } catch (err) {
        logger.warn({ err, type: e.type }, 'realtime delivery failed');
      }
    }
  }

  async function deliverOne(e: RoomEvent, socket: S, viewer: Viewer, opts: { replay?: boolean }) {
    const { roomId, seq } = e;
    switch (e.type) {
      case 'post:new':
      case 'post:update': {
        if (canSeePost(viewer, { authorId: e.authorId, chapterPosition: e.position })) {
          // The gate loads the post again for this viewer; a deleted post simply 404s.
          const post = await getVisiblePost(db, viewer, e.postId).catch(() => null);
          if (post) socket.emit(e.type, { roomId, seq, post });
        } else if (e.type === 'post:new') {
          const count = await waitingCountAt(db, viewer, e.chapterId);
          socket.emit('waiting:count', { roomId, seq, position: e.position, count });
        }
        return;
      }
      case 'reply:new': {
        if (!canSeePost(viewer, { authorId: e.postAuthorId, chapterPosition: e.position })) return;
        const reply = await getVisibleReply(db, viewer, e.replyId).catch(() => null);
        if (reply) socket.emit('reply:new', { roomId, seq, reply });
        return;
      }
      case 'like:update': {
        if (!canSeePost(viewer, { authorId: e.authorId, chapterPosition: e.position })) return;
        socket.emit('like:update', { roomId, seq, postId: e.postId, count: e.count });
        return;
      }
      case 'moderation': {
        if (canSeePost(viewer, { authorId: e.authorId, chapterPosition: e.position })) {
          socket.emit('moderation', { roomId, seq, postId: e.postId, action: 'delete' });
        } else {
          const count = await waitingCountAt(db, viewer, e.chapterId);
          socket.emit('waiting:count', { roomId, seq, position: e.position, count });
        }
        return;
      }
      case 'chapters': {
        socket.emit('room:changed', { roomId, seq });
        return;
      }
      case 'bookmark': {
        if (e.userId === socket.data.userId) {
          if (opts.replay) return; // a reconnecting client refetches its own room state
          // Update this socket's cached bookmark FIRST, then tell it what changed.
          const next: Viewer = { ...viewer, position: e.to.position, finished: e.to.finished };
          socket.data.viewers.set(roomId, next);
          const range = unlockedRange(viewer, next);
          if (range) {
            const posts = await postsUnlockedBetween(db, next, range.above, range.through);
            socket.emit('unlock', {
              roomId,
              seq,
              from: e.from.position,
              to: e.to.position,
              finished: e.to.finished,
              posts,
            });
          } else if (e.to.position < e.from.position || (e.from.finished && !e.to.finished)) {
            socket.emit('relock', {
              roomId,
              seq,
              position: e.to.position,
              finished: e.to.finished,
            });
          }
          return;
        }
        const hidden = await db.membership.findFirst({
          where: {
            userId: e.userId,
            positionHidden: true,
            club: { rooms: { some: { id: roomId } } },
          },
          select: { userId: true },
        });
        if (!hidden) {
          socket.emit('bookmark:update', {
            roomId,
            seq,
            userId: e.userId,
            position: e.to.position,
            finished: e.to.finished,
          });
        }
        if (e.to.finished && !e.from.finished)
          socket.emit('finished', { roomId, seq, userId: e.userId });
        return;
      }
    }
  }

  const unsubscribe = bus.subscribe((e) => {
    void localSockets(e.roomId).then((targets) => deliver(e, targets));
  });

  return {
    /** Tell a user's open tabs that a new in-app notification exists. */
    notifyUser(userId: string, id: string) {
      io.to(`user:${userId}`).emit('notification:new', { id });
    },
    close() {
      unsubscribe();
    },
  };
}
