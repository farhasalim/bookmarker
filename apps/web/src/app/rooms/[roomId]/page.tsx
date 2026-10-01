'use client';
import Link from 'next/link';
import { use, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ChapterDTO, PostDTO, UnlockResult } from '@bookmarker/shared';
import { api } from '@/lib/api';
import { listNames, plural } from '@/lib/format';
import { useMe, useRoom } from '@/lib/hooks';
import { useRoomSocket } from '@/lib/socket';
import { LockIcon, MenuIcon } from '@/components/icons';
import { MoveBar, type PendingMove } from '@/components/MoveBar';
import { PostBar } from '@/components/PostBar';
import { ErrorText, Loading, Screen, TopBar } from '@/components/ui';

const ROW = 52;

export default function ReadingRoom({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const router = useRouter();
  useMe();
  const room = useRoom(roomId);
  const [pending, setPending] = useState<PendingMove>(null);
  const [fromSlider, setFromSlider] = useState(false);
  const [moving, setMoving] = useState(false);
  const [unlock, setUnlock] = useState<UnlockResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [posted, setPosted] = useState<PostDTO | null>(null);

  const refresh = useCallback(() => void room.mutate(), [room]);
  useRoomSocket(
    roomId,
    {
      'post:new': refresh,
      'waiting:count': refresh,
      'bookmark:update': refresh,
      unlock: refresh,
      relock: refresh,
      moderation: refresh,
      finished: refresh,
      'room:changed': refresh,
    },
    refresh,
  );

  const r = room.data;
  const chapters = useMemo(() => r?.chapters.filter((c) => c.kind === 'chapter') ?? [], [r]);
  const afterBook = r?.chapters.find((c) => c.kind === 'after_book');

  if (room.error)
    return (
      <Screen>
        <TopBar back="/home" />
        <p className="p-6">This room doesn’t exist or you’re not in its club.</p>
      </Screen>
    );
  if (!r) return <Loading />;

  const me = r.me;
  const finishedFriends = r.friends.filter((f) => f.finished).map((f) => f.name);
  const friendsAt = (p: number) =>
    r.friends.filter((f) => !f.finished && f.position === p).map((f) => f.name);
  const waitingAt = (p: number) => chapters.find((c) => c.position === p)?.count ?? 0;
  const current = me.finished ? afterBook : chapters.find((c) => c.position === me.position);

  async function confirmMove() {
    if (!pending) return;
    setMoving(true);
    setError(null);
    try {
      const res = await api<UnlockResult>(`/rooms/${roomId}/bookmark`, {
        method: 'PUT',
        json: pending,
      });
      setPending(null);
      setUnlock(res.posts.length > 0 || res.to > res.from ? res : null);
      await room.mutate();
      if (pending.finished && !me.finished) router.push(`/rooms/${roomId}/finish`);
    } catch (e) {
      setError(e);
    } finally {
      setMoving(false);
    }
  }

  const propose = (position: number, slider = false) => {
    if (!r.chaptersConfirmed) return;
    setFromSlider(slider);
    if (position === me.position && !me.finished) return setPending(null);
    setUnlock(null);
    setPending({ position, finished: false });
  };

  const sliderValue =
    pending && !pending.finished ? pending.position : me.finished ? chapters.length : me.position;

  return (
    <Screen>
      <TopBar
        back="/home"
        title={r.clubName}
        right={
          <Link
            href={me.isHost ? `/rooms/${roomId}/setup` : `/clubs/${r.clubId}`}
            aria-label={me.isHost ? 'Edit chapters' : 'Club'}
            className="flex h-11 w-11 items-center justify-center text-ink"
          >
            <MenuIcon />
          </Link>
        }
      />
      <section className="flex flex-col gap-1 border-b border-rule px-6 pb-3.5 pt-1.5">
        <h1 className="font-serif text-[30px] font-medium leading-[1.1] tracking-tight">
          {r.title}
        </h1>
        <p className="text-sm text-muted">
          {r.author ? `${r.author} · ` : ''}
          {plural(r.chapterCount, 'chapter')} ·{' '}
          {me.finished
            ? 'you finished it'
            : me.position === 0
              ? 'not started'
              : `you’re on chapter ${me.position}`}
        </p>
        {finishedFriends.length > 0 && !me.finished && (
          <p className="mt-0.5 font-serif text-sm italic text-muted">
            {listNames(finishedFriends)} {finishedFriends.length === 1 ? 'has' : 'have'} finished it
            already
          </p>
        )}
        {me.finished && (
          <p className="mt-1 text-sm">
            <Link href={`/rooms/${roomId}/reviews`}>Read the reviews</Link> ·{' '}
            <Link href={`/rooms/${roomId}/finish`}>Your rating</Link>
          </p>
        )}
      </section>

      {!r.chaptersConfirmed && (
        <p className="mx-6 mt-4 rounded bg-panel p-3 text-sm">
          {me.isHost ? (
            <>
              This room is a draft.{' '}
              <Link href={`/rooms/${roomId}/setup`}>Confirm the chapters</Link> so everyone can
              start.
            </>
          ) : (
            'The host is still setting up the chapters. You can move your bookmark once they’re confirmed.'
          )}
        </p>
      )}

      <div className="flex items-baseline justify-between px-6 pb-1.5 pt-3.5">
        <h2 className="font-serif text-base italic text-muted">Contents</h2>
        <span className="text-xs text-muted">drag the ribbon or tap a chapter</span>
      </div>
      <ErrorText error={error} />

      <main id="main" className="relative flex-1 px-4 pl-3">
        <ol className="relative">
          {chapters.map((c) => (
            <ChapterRow
              key={c.id}
              c={c}
              roomId={roomId}
              isBookmark={!me.finished && c.position === me.position}
              reached={me.finished || c.position <= me.position}
              pendingHere={!!pending && !pending.finished && pending.position === c.position}
              friends={friendsAt(c.position)}
              onPropose={() => propose(c.position)}
              unlock={
                unlock && c.position === Math.min(unlock.to, chapters.length) && !unlock.finished
                  ? unlock
                  : null
              }
            />
          ))}
          {afterBook && (
            <li className="grid grid-cols-[36px_minmax(0,1fr)]">
              <div className="flex justify-center">
                <div
                  className={`h-[52px] ${me.finished ? 'w-1.5 bg-spine' : 'w-0.5 bg-spine-off'}`}
                />
              </div>
              {me.finished ? (
                <Link
                  href={`/rooms/${roomId}/chapters/${afterBook.id}`}
                  className="flex h-[52px] items-center gap-2 border-b border-rule-soft px-1.5 text-ink no-underline hover:bg-highlight hover:text-ink"
                >
                  <span className="font-serif text-lg italic">After the book</span>
                  <Leader />
                  <span className="text-[13px]">
                    {afterBook.count === 0 ? 'no thoughts yet' : plural(afterBook.count, 'thought')}
                  </span>
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={!r.chaptersConfirmed}
                  onClick={() => setPending({ position: chapters.length, finished: true })}
                  className="flex h-[52px] items-center gap-2 border-b border-rule-soft px-1.5 text-left text-muted"
                >
                  <span className="font-serif text-lg italic">After the book</span>
                  <Leader />
                  <span className="text-[13px]">
                    {afterBook.count === 0 ? 'opens when you finish' : `${afterBook.count} waiting`}
                  </span>
                  <LockIcon />
                </button>
              )}
            </li>
          )}
        </ol>

        {/* The ribbon slider (MVP-5): drag or use arrow keys; nothing moves until you confirm. */}
        {r.chaptersConfirmed && (
          <div
            className="absolute left-3 top-0 w-9 rounded focus-within:outline focus-within:outline-3 focus-within:outline-accent"
            style={{ height: chapters.length * ROW }}
          >
            <input
              type="range"
              min={0}
              max={chapters.length}
              step={1}
              value={sliderValue}
              aria-label="Bookmark: the last chapter you finished"
              aria-valuetext={
                sliderValue === 0 ? 'Not started' : `Chapter ${sliderValue} of ${chapters.length}`
              }
              onChange={(e) => propose(Number(e.target.value), true)}
              className="h-full w-full cursor-grab opacity-0"
              style={{ writingMode: 'vertical-lr' }}
            />
          </div>
        )}

        {!me.finished && me.position === chapters.length && chapters.length > 0 && (
          <div className="my-4 px-2">
            <button
              type="button"
              onClick={() => setPending({ position: chapters.length, finished: true })}
              className="min-h-11 font-semibold text-accent"
            >
              I’ve finished the book
            </button>
          </div>
        )}
        <p className="px-2 py-5 text-[13px] leading-normal text-muted">
          Moved too far? Drag the ribbon back up. Your own thoughts always stay with you.
        </p>
      </main>

      <MoveBar
        pending={pending}
        current={me}
        waitingAt={waitingAt}
        busy={moving}
        onConfirm={confirmMove}
        onCancel={() => setPending(null)}
        focusConfirm={!fromSlider}
      />

      {!pending && current && r.chaptersConfirmed && (me.position > 0 || me.finished) && (
        <div className="sticky bottom-0">
          {posted && (
            <p role="status" className="bg-highlight px-6 py-2 text-sm">
              Posted.{' '}
              <Link href={`/rooms/${roomId}/chapters/${posted.chapterId}`}>
                See it with the others
              </Link>
            </p>
          )}
          <PostBar
            chapterId={current.id}
            position={current.position}
            afterBook={me.finished}
            friends={r.friends}
            onPosted={(p) => {
              setPosted(p);
              void room.mutate();
            }}
          />
        </div>
      )}
      {!pending && r.chaptersConfirmed && me.position === 0 && !me.finished && (
        <p className="sticky bottom-0 border-t border-rule bg-panel px-6 py-4 text-sm">
          Where are you in the book? Tap the last chapter you finished, or drag the ribbon.
        </p>
      )}
    </Screen>
  );
}

function Leader() {
  return <span aria-hidden className="mt-2 h-px flex-1 border-b border-dotted border-muted/50" />;
}

function ChapterRow({
  c,
  roomId,
  isBookmark,
  reached,
  pendingHere,
  friends,
  onPropose,
  unlock,
}: {
  c: ChapterDTO;
  roomId: string;
  isBookmark: boolean;
  reached: boolean;
  pendingHere: boolean;
  friends: string[];
  onPropose: () => void;
  unlock: UnlockResult | null;
}) {
  const countText = reached
    ? c.count === 0
      ? 'no thoughts yet'
      : plural(c.count, 'thought')
    : c.count === 0
      ? 'quiet so far'
      : `${c.count} waiting`;
  const label = `Chapter ${c.position}${c.title !== `Chapter ${c.position}` ? `, ${c.title}` : ''}`;
  const inner = (
    <>
      <span className={`whitespace-nowrap font-serif text-lg ${isBookmark ? 'font-semibold' : ''}`}>
        {c.title === `Chapter ${c.position}` ? (
          c.title
        ) : (
          <>
            {c.position}. {c.title}
          </>
        )}
      </span>
      {friends.length > 0 && (
        <span className="truncate font-serif text-sm italic text-muted">{friends.join(', ')}</span>
      )}
      <Leader />
      <span className="whitespace-nowrap text-[13px]">{countText}</span>
      {!reached && <LockIcon className="text-muted" />}
    </>
  );
  const rowClass = `flex h-[52px] min-w-0 items-center gap-2 border-b border-rule-soft px-1.5 text-left no-underline ${
    isBookmark ? 'bg-highlight' : ''
  } ${pendingHere ? 'outline outline-2 outline-accent' : ''} ${reached ? 'text-ink hover:text-ink' : 'text-muted'}`;
  const upCount = unlock?.posts.filter((p) => p.position === c.position) ?? [];

  return (
    <li>
      <div className="grid grid-cols-[36px_minmax(0,1fr)]">
        <div className="relative flex justify-center">
          <div className={`h-[52px] ${reached ? 'w-1.5 bg-spine' : 'w-0.5 bg-spine-off'}`} />
          {isBookmark && (
            <div
              aria-hidden
              className="ribbon absolute left-[9px] top-[9px] h-[34px] w-[18px] bg-accent"
            />
          )}
          {!isBookmark && (
            <div
              aria-hidden
              className={`absolute left-[14px] top-[22px] h-2 w-2 rounded ${reached ? 'bg-accent/70' : 'bg-spine-off'}`}
            />
          )}
        </div>
        {reached ? (
          <Link
            href={`/rooms/${roomId}/chapters/${c.id}`}
            className={rowClass}
            aria-label={`${label}, read, ${countText}`}
          >
            {inner}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onPropose}
            className={rowClass}
            aria-label={`${label}, not read yet, ${countText}. Move bookmark here`}
          >
            {inner}
          </button>
        )}
      </div>
      {unlock && (
        <div className="unlock-enter grid grid-cols-[36px_minmax(0,1fr)]" role="status">
          <div className="flex justify-center">
            <div className="w-1.5 bg-spine" />
          </div>
          <div className="flex flex-col gap-3 border-b border-rule bg-highlight px-3 pb-4 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-serif text-xl font-semibold">Chapter {c.position}</span>
              <span className="font-serif text-sm italic text-accent">just opened</span>
            </div>
            <p className="text-sm">
              {unlock.posts.length === 0
                ? 'Nothing was waiting. You could be the first to leave a thought.'
                : upCount.length > 0
                  ? `${plural(upCount.length, 'thought')} ${upCount.length === 1 ? 'was' : 'were'} waiting here for you${unlock.posts.length > upCount.length ? `, and ${unlock.posts.length - upCount.length} more in the chapters you passed` : ''}.`
                  : `${plural(unlock.posts.length, 'thought')} opened in the chapters you passed.`}
            </p>
            {upCount.slice(0, 2).map((p) => (
              <div key={p.id} className="border-l-2 border-spine pl-3">
                <div className="text-[13px] font-bold">{p.author.name}</div>
                <div className="font-serif text-base leading-snug">{p.body}</div>
              </div>
            ))}
            <Link
              href={`/rooms/${roomId}/chapters/${c.id}`}
              className="flex min-h-11 items-center text-sm font-semibold"
            >
              {upCount.length > 0 ? `Read all ${upCount.length} and add yours` : 'Add your thought'}
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
