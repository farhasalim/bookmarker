'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe, useNotifications } from '@/lib/hooks';
import { BottomNav, ErrorText, Loading, Ribbon, Screen } from '@/components/ui';

import { PENDING_INVITE } from '@/lib/constants';

export default function Home() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: letters } = useNotifications();
  const [joinError, setJoinError] = useState<unknown>(null);

  // Finish an invite that was opened before signing in.
  useEffect(() => {
    if (!me) return;
    let token: string | null = null;
    try {
      token = localStorage.getItem(PENDING_INVITE);
    } catch {
      token = null;
    }
    if (!token) return;
    try {
      localStorage.removeItem(PENDING_INVITE);
    } catch {
      /* ignore */
    }
    api<{ clubId: string }>(`/invites/${token}/accept`, { method: 'POST' })
      .then((r) => router.push(`/clubs/${r.clubId}`))
      .catch(setJoinError);
  }, [me, router]);

  if (!me) return <Loading />;
  const rooms = me.clubs.flatMap((c) =>
    c.currentRooms.map((r) => ({ ...r, clubName: c.name, clubId: c.id })),
  );

  return (
    <Screen>
      <main id="main" className="flex-1 px-6 pb-8 pt-8">
        <h1 className="font-serif text-[30px] font-medium">Reading</h1>
        <ErrorText error={joinError} />
        {rooms.length === 0 ? (
          <div className="mt-8 rounded bg-panel p-5">
            <p className="font-serif text-lg">You aren’t reading anything with a club yet.</p>
            <p className="mt-2 text-[15px] text-muted">
              Start a club and invite friends, or open an invite link someone sent you.
            </p>
            <Link
              href="/clubs/new"
              className="mt-4 inline-flex min-h-11 items-center font-semibold"
            >
              Start a club
            </Link>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-4">
            {rooms.map((r) => {
              const pct = r.finished
                ? 100
                : r.chapterCount
                  ? Math.round((r.position / r.chapterCount) * 100)
                  : 0;
              return (
                <li key={r.id}>
                  <Link
                    href={`/rooms/${r.id}`}
                    className="relative block rounded bg-paper p-4 text-ink no-underline shadow-[0_1px_0_var(--rule)] hover:bg-highlight hover:text-ink"
                  >
                    <Ribbon className="absolute right-5 top-0 h-8 w-4" />
                    <div className="text-sm text-muted">{r.clubName}</div>
                    <div className="mt-1 pr-8 font-serif text-[22px] font-medium leading-tight">
                      {r.title}
                    </div>
                    {r.author && <div className="text-sm text-muted">{r.author}</div>}
                    <div className="mt-3 h-1.5 rounded bg-spine-off" aria-hidden>
                      <div className="h-1.5 rounded bg-spine" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 text-sm">
                      {!r.chaptersConfirmed
                        ? 'The host is setting up the chapters'
                        : r.finished
                          ? 'Finished'
                          : r.position === 0
                            ? 'Not started'
                            : `Chapter ${r.position} of ${r.chapterCount}`}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <BottomNav unread={letters?.unread ?? 0} />
    </Screen>
  );
}
