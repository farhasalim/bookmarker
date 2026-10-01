'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { plural, timeAgo } from '@/lib/format';
import { useMe, useNotifications } from '@/lib/hooks';
import type { NotificationItem } from '@/lib/types';
import { BottomNav, Loading, Screen } from '@/components/ui';

type Pos = { position: number; finished: boolean };

/** "Letters": in-app notifications. Names, chapter numbers and counts only. */
export default function Letters() {
  useMe();
  const { data, mutate } = useNotifications();

  useEffect(() => {
    if (data && data.unread > 0) {
      const t = setTimeout(
        () => void api('/notifications/read-all', { method: 'POST' }).then(() => mutate()),
        1500,
      );
      return () => clearTimeout(t);
    }
  }, [data, mutate]);

  if (!data) return <Loading />;
  return (
    <Screen>
      <header className="flex items-baseline justify-between border-b border-rule px-6 pb-3.5 pt-[26px]">
        <h1 className="font-serif text-[30px] font-medium">Letters</h1>
        <Link href="/settings#notifications" className="text-sm">
          Reminder settings
        </Link>
      </header>
      <main id="main" className="flex-1">
        {data.notifications.length === 0 && (
          <p className="px-6 py-8 font-serif text-lg italic text-muted">
            Nothing yet. Letters about your books will gather here.
          </p>
        )}
        {data.notifications.map((n) => (
          <Letter key={n.id} n={n} />
        ))}
      </main>
      <p className="border-t border-rule px-6 pb-6 pt-4 font-serif text-sm italic text-muted">
        Nothing written past your bookmark ever reaches you here.
      </p>
      <BottomNav unread={data.unread} />
    </Screen>
  );
}

function Letter({ n }: { n: NotificationItem }) {
  const p = n.payload as Record<string, unknown>;
  const room = n.roomId ? `/rooms/${n.roomId}` : '/home';
  const when = (
    <div className="text-xs text-muted">
      {timeAgo(n.sentAt)}
      {!n.read && <span className="ml-2 font-semibold text-accent">new</span>}
    </div>
  );

  if (n.type === 'reminder') {
    const waiting = Number(p.waiting ?? 0);
    return (
      <article className="flex flex-col gap-2 border-b border-rule-soft px-6 py-5">
        {when}
        <h2 className="font-serif text-2xl font-medium leading-tight">
          Chapter {String(p.nextPosition)} is waiting for you
        </h2>
        <p className="font-serif text-[17px] leading-normal">
          It has been {plural(Number(p.days ?? 3), 'day')} since your last chapter.{' '}
          {waiting > 0
            ? `${plural(waiting, 'thought')} ${waiting === 1 ? 'is' : 'are'} already there, ready when you are.`
            : 'You could be the first to leave a thought.'}
        </p>
        <Link href={room} className="flex min-h-11 items-center self-start font-semibold">
          Pick up {String(p.roomTitle ?? 'your book')}
        </Link>
      </article>
    );
  }
  if (n.type === 'weekly') {
    const you = p.you as Pos;
    const friends = (p.friends as Array<Pos & { name: string }>) ?? [];
    return (
      <article className="flex flex-col gap-3 border-b border-rule-soft px-6 py-5">
        {when}
        <h2 className="font-serif text-2xl font-medium leading-tight">
          Where everyone is this week
        </h2>
        <p className="text-sm text-muted">{String(p.roomTitle ?? '')}</p>
        <ul className="flex flex-col gap-1 text-[15px]">
          <li>
            <b>You</b> · {where(you)}
          </li>
          {friends.map((f) => (
            <li key={f.name} className="font-serif italic">
              {f.name} · {where(f)}
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">Chapter numbers only, never what’s in them.</p>
      </article>
    );
  }
  const text =
    n.type === 'post' ? (
      <>
        <b>{String(p.authorName)}</b> left a thought at chapter {String(p.position)}
      </>
    ) : n.type === 'reply' ? (
      <>
        <b>{String(p.replierName)}</b> replied to your thought at chapter {String(p.position)}
      </>
    ) : n.type === 'friend_finished' ? (
      <>
        <b>{String(p.friendName)}</b> finished {String(p.roomTitle ?? 'the book')}
      </>
    ) : (
      'Something new in your club'
    );
  return (
    <article className="border-b border-rule-soft px-6 py-[18px]">
      {when}
      <Link
        href={n.chapterId && n.roomId ? `/rooms/${n.roomId}/chapters/${n.chapterId}` : room}
        className="mt-1 block text-[15px] text-ink no-underline hover:underline"
      >
        {text}
      </Link>
      {n.type === 'post' && (
        <div className="text-[13px] text-muted">You’ve read this far, so you hear about it.</div>
      )}
    </article>
  );
}

const where = (p: Pos) =>
  p.finished ? 'finished' : p.position === 0 ? 'not started' : `chapter ${p.position}`;
