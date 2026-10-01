'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { useMe, useNotifications } from '@/lib/hooks';
import type { Profile, ProfileBook } from '@/lib/types';
import { GearIcon, StarIcon } from '@/components/icons';
import { Avatar, BottomNav, Loading, Screen, TopBar } from '@/components/ui';

const SPINES = [
  'var(--spine)',
  'var(--panel-2)',
  'var(--accent)',
  'var(--highlight)',
  'var(--spine-off)',
  'var(--panel)',
];

/** Profile and stars (FR-18). Ratings follow the review gate decided with Farha. */
export default function ProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { data: me } = useMe();
  const { data: letters } = useNotifications();
  const profile = useSWR<Profile>(`/users/${userId}/profile`, fetcher);
  const [tab, setTab] = useState<'shelf' | 'reviews'>('shelf');
  if (profile.error)
    return (
      <Screen>
        <TopBar back="/home" />
        <p className="p-6">You can see profiles of people in your clubs.</p>
      </Screen>
    );
  if (!profile.data || !me) return <Loading />;
  const p = profile.data;
  const self = p.id === me.id;

  return (
    <Screen>
      <header className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center border-b border-rule px-3 pb-2 pt-3">
        <span />
        <h1 className="text-center text-base font-bold">Profile</h1>
        {self ? (
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex h-11 w-11 items-center justify-center text-ink"
          >
            <GearIcon />
          </Link>
        ) : (
          <span />
        )}
      </header>
      <main id="main" className="flex-1">
        <section className="flex items-center gap-4 px-6 pb-4 pt-5">
          <Avatar name={p.name} url={p.avatarUrl} size={84} />
          <div className="min-w-0">
            <h2 className="font-serif text-[26px] font-medium leading-tight">{p.name}</h2>
            <div className="text-sm text-muted">reading since {p.readingSince}</div>
            <div className="text-[13px] text-muted">{p.clubs.map((c) => c.name).join(', ')}</div>
          </div>
        </section>
        {self && (
          <div className="px-6 pb-4">
            <Link
              href="/settings"
              className="flex min-h-10 items-center justify-center rounded border border-rule text-sm font-semibold text-ink no-underline"
            >
              Edit profile
            </Link>
          </div>
        )}
        <dl className="mx-6 grid grid-cols-3 border-y border-rule text-center">
          <div className="py-3">
            <dd className="flex items-center justify-center gap-1 font-serif text-[26px] font-medium">
              {p.starTotal}
              <StarIcon size={18} />
            </dd>
            <dt className="text-xs text-muted">stars</dt>
          </div>
          <div className="border-x border-rule py-3">
            <dd className="font-serif text-[26px] font-medium">{p.booksFinished}</dd>
            <dt className="text-xs text-muted">books finished</dt>
          </div>
          <div className="py-3">
            <dd className="font-serif text-[26px] font-medium">{p.reviewsWritten}</dd>
            <dt className="text-xs text-muted">reviews</dt>
          </div>
        </dl>
        <div
          role="tablist"
          aria-label="Profile sections"
          className="flex gap-6 border-b border-rule-soft px-6 pt-3.5"
        >
          {(['shelf', 'reviews'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-11 pb-2.5 text-sm capitalize ${tab === t ? 'border-b-2 border-accent font-bold' : 'text-muted'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'shelf' ? <Shelf books={p.books} /> : <ReviewList books={p.books} />}
      </main>
      <BottomNav unread={letters?.unread ?? 0} />
    </Screen>
  );
}

function Shelf({ books }: { books: ProfileBook[] }) {
  if (books.length === 0)
    return <p className="px-6 py-8 font-serif text-lg italic text-muted">No finished books yet.</p>;
  return (
    <div
      role="list"
      aria-label="Finished books"
      className="mx-6 mt-4 flex h-[190px] items-end gap-1.5 overflow-x-auto border-b-[6px] border-spine-off px-1.5"
    >
      {books.map((b, i) => (
        <div
          role="listitem"
          key={b.roomId}
          title={b.rating ? `${b.title}, rated ${b.rating}` : b.title}
          aria-label={`${b.title}${b.rating ? `, rated ${b.rating} of 5` : ''}${b.stars ? `, ${b.stars} stars earned` : ''}`}
          className="flex shrink-0 items-center justify-center rounded-t-sm text-ink"
          style={{
            width: 32 + ((b.title.length * 7) % 18),
            height: 140 + ((b.title.length * 13) % 45),
            background: SPINES[i % SPINES.length],
          }}
        >
          <span
            className="max-h-[170px] overflow-hidden font-serif text-sm [writing-mode:vertical-rl] rotate-180"
            style={{ color: i % SPINES.length === 2 ? 'var(--on-accent)' : undefined }}
          >
            {b.title}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReviewList({ books }: { books: ProfileBook[] }) {
  const reviewed = books.filter((b) => b.review || b.rating);
  if (reviewed.length === 0)
    return <p className="px-6 py-8 font-serif text-lg italic text-muted">No reviews to show.</p>;
  return (
    <ul className="flex flex-col">
      {reviewed.map((b) => (
        <ReviewItem key={b.roomId} b={b} />
      ))}
    </ul>
  );
}

function ReviewItem({ b }: { b: ProfileBook }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <li className="border-b border-rule-soft px-6 py-4">
      <div className="flex items-center justify-between">
        <span className="font-serif text-lg">{b.title}</span>
        {b.rating && (
          <span className="flex" role="img" aria-label={`${b.rating} of 5 stars`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <StarIcon key={n} size={14} filled={n <= b.rating!} />
            ))}
          </span>
        )}
      </div>
      {b.review &&
        (b.review.spoilerGuarded && !revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-2 min-h-11 rounded bg-panel px-3 text-sm"
          >
            May contain spoilers. Tap to read the review.
          </button>
        ) : (
          <p className="mt-2 whitespace-pre-wrap font-serif text-base leading-normal">
            {b.review.body}
          </p>
        ))}
    </li>
  );
}
