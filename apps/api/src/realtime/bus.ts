import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import type { Tx } from '@bookmarker/db';

/**
 * Room events carry IDS ONLY. Content is looked up through the gate by whoever
 * delivers the event, for each recipient, at delivery time. So neither the
 * event log nor Redis ever holds post text.
 */
export type RoomEvent =
  | { type: 'post:new'; roomId: string; seq: number; postId: string; chapterId: string; position: number; authorId: string }
  | { type: 'post:update'; roomId: string; seq: number; postId: string; position: number; authorId: string }
  | { type: 'reply:new'; roomId: string; seq: number; postId: string; replyId: string; position: number; postAuthorId: string }
  | { type: 'like:update'; roomId: string; seq: number; postId: string; position: number; authorId: string; count: number }
  | { type: 'bookmark'; roomId: string; seq: number; userId: string; from: { position: number; finished: boolean }; to: { position: number; finished: boolean } }
  | { type: 'moderation'; roomId: string; seq: number; postId: string; position: number; authorId: string; chapterId: string }
  | { type: 'chapters'; roomId: string; seq: number };

type WithoutSeq<T> = T extends unknown ? Omit<T, 'seq'> : never;
export type RoomEventInput = WithoutSeq<RoomEvent>;

/** Fan-out channel between API instances. In-process for one instance/tests; Redis for many. */
export interface EventBus {
  publish(e: RoomEvent): Promise<void>;
  subscribe(fn: (e: RoomEvent) => void): () => void;
}

export function memoryBus(): EventBus {
  const em = new EventEmitter();
  em.setMaxListeners(0);
  return {
    async publish(e) {
      em.emit('e', e);
    },
    subscribe(fn) {
      em.on('e', fn);
      return () => em.off('e', fn);
    },
  };
}

const CHANNEL = 'bookmarker:room-events';

export async function redisBus(pub: Redis, sub: Redis): Promise<EventBus> {
  const local = memoryBus();
  await sub.subscribe(CHANNEL);
  sub.on('message', (_ch, msg) => {
    try {
      void local.publish(JSON.parse(msg) as RoomEvent);
    } catch {
      /* ignore malformed */
    }
  });
  return {
    async publish(e) {
      await pub.publish(CHANNEL, JSON.stringify(e));
    },
    subscribe: local.subscribe,
  };
}

/**
 * Append an event to the room's log inside the caller's transaction and return it
 * with its sequence number. Publish it with `bus.publish` AFTER the transaction
 * commits, so nobody hears about a write that was rolled back.
 */
export async function recordEvent(tx: Tx, input: RoomEventInput): Promise<RoomEvent> {
  const { eventSeq } = await tx.room.update({
    where: { id: input.roomId },
    data: { eventSeq: { increment: 1 } },
    select: { eventSeq: true },
  });
  const { type, roomId, ...payload } = input;
  await tx.roomEvent.create({ data: { roomId, seq: eventSeq, type, payload } });
  return { ...input, seq: eventSeq } as RoomEvent;
}
