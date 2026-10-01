'use client';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bookmarker/shared';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
let shared: S | null = null;

/** One socket per tab (SRS section 7), authenticated by the session cookie. */
export function getSocket(): S {
  if (!shared) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined; // same origin in production
    shared = io(url ?? '', {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000, // SRS: exponential backoff 1 s → 30 s
    });
  }
  return shared;
}

type Handlers = Partial<{ [K in keyof ServerToClientEvents]: ServerToClientEvents[K] }>;

/**
 * Join a room channel and listen to its events. On reconnect it re-joins with the
 * last seq it saw, so the server replays (through the gate) what was missed.
 */
export function useRoomSocket(
  roomId: string | undefined,
  handlers: Handlers,
  onResync: () => void,
) {
  const h = useRef(handlers);
  h.current = handlers;
  const lastSeq = useRef<number | undefined>(undefined);
  const resync = useRef(onResync);
  resync.current = onResync;

  useEffect(() => {
    if (!roomId) return;
    const socket = getSocket();
    const seen = (seq: number) => {
      if (lastSeq.current === undefined || seq > lastSeq.current) lastSeq.current = seq;
    };
    const join = () =>
      socket.emit(
        'room:join',
        { roomId, ...(lastSeq.current !== undefined ? { lastSeq: lastSeq.current } : {}) },
        (r) => {
          if (r.ok && r.seq !== undefined && lastSeq.current === undefined) lastSeq.current = r.seq;
        },
      );
    const names = [
      'post:new',
      'post:update',
      'reply:new',
      'like:update',
      'waiting:count',
      'bookmark:update',
      'unlock',
      'relock',
      'finished',
      'moderation',
      'room:changed',
    ] as const;
    const listeners = names.map((name) => {
      const fn = (e: { roomId: string; seq: number }) => {
        if (e.roomId !== roomId) return;
        seen(e.seq);
        (h.current[name] as ((x: unknown) => void) | undefined)?.(e);
      };
      socket.on(name, fn as never);
      return [name, fn] as const;
    });
    const onReplayDone = () => resync.current();
    socket.on('room:replay-done', onReplayDone);
    socket.on('connect', join);
    if (socket.connected) join();
    return () => {
      socket.emit('room:leave', { roomId });
      for (const [name, fn] of listeners) socket.off(name, fn as never);
      socket.off('room:replay-done', onReplayDone);
      socket.off('connect', join);
    };
  }, [roomId]);
}
