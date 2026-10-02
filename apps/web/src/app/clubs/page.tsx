'use client';
import Link from 'next/link';
import { useMe, useNotifications } from '@/lib/hooks';
import { BottomNav, Loading, Screen, TopRow } from '@/components/ui';

export default function Clubs() {
  const { data: me } = useMe();
  const { data: letters } = useNotifications();
  if (!me) return <Loading />;
  return (
    <Screen>
      <TopRow />
      <main id="main" className="flex-1 px-6 pb-8 pt-0">
        <div className="flex items-baseline justify-between">
          <h1 className="font-serif text-[30px] font-medium">Clubs</h1>
          <Link href="/clubs/new" className="font-semibold">
            Start a club
          </Link>
        </div>
        {me.clubs.length === 0 ? (
          <p className="mt-6 font-serif text-lg">
            No clubs yet. Start one, or open an invite link from a friend.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-rule-soft border-y border-rule-soft">
            {me.clubs.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clubs/${c.id}`}
                  className="flex min-h-16 items-center justify-between py-3 text-ink no-underline hover:text-ink"
                >
                  <span>
                    <span className="block font-serif text-xl">{c.name}</span>
                    <span className="text-sm text-muted">
                      {c.role === 'host' ? 'You host' : 'Member'}
                      {c.currentRooms[0] ? ` · reading ${c.currentRooms[0].title}` : ''}
                    </span>
                  </span>
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <BottomNav unread={letters?.unread ?? 0} />
    </Screen>
  );
}
