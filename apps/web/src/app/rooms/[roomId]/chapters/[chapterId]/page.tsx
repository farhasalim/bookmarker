'use client';
import Link from 'next/link';
import { use, useCallback, useState } from 'react';
import useSWR from 'swr';
import type { PostDTO, UnlockResult } from '@bookmarker/shared';
import { api, fetcher, showLoadError } from '@/lib/api';
import { plural } from '@/lib/format';
import { useMe, useRoom } from '@/lib/hooks';
import { useRoomSocket } from '@/lib/socket';
import { LockIcon } from '@/components/icons';
import { MoveBar, type PendingMove } from '@/components/MoveBar';
import { PostBar } from '@/components/PostBar';
import { PostCard } from '@/components/PostCard';
import { ErrorText, Loading, Screen, TopBar } from '@/components/ui';

/** Chapter view: the posts at one chapter, and the post bar if it's your bookmark. */
export default function ChapterView({
  params,
}: {
  params: Promise<{ roomId: string; chapterId: string }>;
}) {
  const { roomId, chapterId } = use(params);
  useMe();
  const room = useRoom(roomId);
  const posts = useSWR<{ posts: PostDTO[]; nextCursor: string | null }>(
    `/chapters/${chapterId}/posts?limit=50`,
    fetcher,
  );
  const [pending, setPending] = useState<PendingMove>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(() => {
    void room.mutate();
    void posts.mutate();
  }, [room, posts]);
  useRoomSocket(
    roomId,
    {
      'post:new': (e) => e.post.chapterId === chapterId && void posts.mutate(),
      'post:update': refresh,
      'reply:new': refresh,
      'like:update': refresh,
      moderation: refresh,
      unlock: refresh,
      relock: refresh,
      'waiting:count': () => void room.mutate(),
      'bookmark:update': () => void room.mutate(),
      'room:changed': refresh,
    },
    refresh,
  );

  const r = room.data;
  if (showLoadError(room.error, room.data))
    return (
      <Screen>
        <TopBar back="/home" />
        <p className="p-6">This chapter isn’t available.</p>
      </Screen>
    );
  if (!r) return <Loading />;
  const chapter = r.chapters.find((c) => c.id === chapterId);
  if (!chapter)
    return (
      <Screen>
        <TopBar back={`/rooms/${roomId}`} />
        <p className="p-6">That chapter isn’t in this book.</p>
      </Screen>
    );

  const me = r.me;
  const afterBook = chapter.kind === 'after_book';
  const isMine = afterBook ? me.finished : !me.finished && me.position === chapter.position;
  const list = posts.data?.posts ?? [];

  async function confirmMove() {
    if (!pending) return;
    setMoving(true);
    setError(null);
    try {
      await api<UnlockResult>(`/rooms/${roomId}/bookmark`, { method: 'PUT', json: pending });
      setPending(null);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setMoving(false);
    }
  }

  return (
    <Screen>
      <TopBar
        back={`/rooms/${roomId}`}
        title={r.title}
        right={
          !afterBook && r.chaptersConfirmed && !isMine && !me.finished ? (
            <button
              type="button"
              onClick={() => setPending({ position: chapter.position, finished: false })}
              className="min-h-11 px-2 text-sm font-semibold text-accent"
            >
              Move bookmark here
            </button>
          ) : undefined
        }
      />
      <section className="flex items-end justify-between border-b border-rule px-6 pb-4 pt-1">
        <div>
          <div className="font-serif text-base italic text-muted">
            {afterBook ? 'After' : 'Chapter'}
          </div>
          <h1 className="font-serif text-[56px] font-normal leading-[0.95]">
            {afterBook ? 'the book' : chapter.position}
          </h1>
          {!afterBook && chapter.title !== `Chapter ${chapter.position}` && (
            <div className="mt-1 font-serif text-lg">{chapter.title}</div>
          )}
        </div>
        <div className="text-right text-[13px] leading-normal text-muted">
          {chapter.unlocked ? plural(chapter.count, 'thought') : `${chapter.count} waiting`}
          {isMine && (
            <>
              <br />
              your bookmark is here
            </>
          )}
        </div>
      </section>
      <ErrorText error={error} />

      <main id="main" className="flex-1">
        {!chapter.unlocked && (
          <div className="m-6 flex gap-3 rounded bg-panel p-4">
            <LockIcon size={18} className="mt-0.5 shrink-0" />
            <p className="text-[15px]">
              {afterBook
                ? 'These thoughts open when you mark the book finished.'
                : `You haven’t reached this chapter yet. ${chapter.count > 0 ? `${plural(chapter.count, 'thought')} ${chapter.count === 1 ? 'is' : 'are'} waiting here. ` : ''}Move your bookmark here once you’ve read it.`}
            </p>
          </div>
        )}
        {list.length === 0 && chapter.unlocked && (
          <p className="px-6 py-8 font-serif text-lg italic text-muted">No thoughts here yet.</p>
        )}
        {list.map((p) => (
          <PostCard key={p.id} post={p} isHost={me.isHost} onChanged={refresh} />
        ))}
        {!chapter.unlocked && list.length > 0 && (
          <p className="px-6 py-3 text-xs text-muted">
            Shown above: your own thoughts here, which always stay with you.
          </p>
        )}
        <p className="px-6 py-6 text-sm">
          <Link href={`/rooms/${roomId}`}>Back to contents</Link>
        </p>
      </main>

      <MoveBar
        pending={pending}
        current={me}
        waitingAt={() => chapter.count}
        busy={moving}
        onConfirm={confirmMove}
        onCancel={() => setPending(null)}
      />
      {!pending && isMine && r.chaptersConfirmed && (
        <div className="sticky bottom-0">
          <PostBar
            chapterId={chapter.id}
            position={chapter.position}
            afterBook={afterBook}
            friends={r.friends}
            rows={3}
            showAudience
            onPosted={() => refresh()}
          />
        </div>
      )}
    </Screen>
  );
}
