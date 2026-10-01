'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { api, fetcher } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import type { ClubDetail, ReportItem } from '@/lib/types';
import { Avatar, Button, ErrorText, Loading, Screen, TopBar } from '@/components/ui';

interface Invite {
  id: string;
  expiresAt: string;
  maxUses: number | null;
  uses: number;
}

export default function Club({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = use(params);
  const router = useRouter();
  const { data: me } = useMe();
  const club = useSWR<ClubDetail>(`/clubs/${clubId}`, fetcher);
  const isHost = club.data?.me.role === 'host';
  const invites = useSWR<{ invites: Invite[] }>(
    isHost ? `/clubs/${clubId}/invites` : null,
    fetcher,
  );
  const reports = useSWR<{ reports: ReportItem[] }>(
    isHost ? `/clubs/${clubId}/reports` : null,
    fetcher,
  );
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (club.error)
    return (
      <Screen>
        <TopBar back="/clubs" />
        <p className="p-6">This club doesn’t exist or you’re not a member.</p>
      </Screen>
    );
  if (!club.data || !me) return <Loading />;
  const c = club.data;
  const current = c.rooms.filter((r) => r.status === 'current');
  const shelf = c.rooms.filter((r) => r.status === 'done');

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await Promise.all([club.mutate(), invites.mutate(), reports.mutate()]);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen>
      <TopBar back="/clubs" title="Club" />
      <main id="main" className="flex flex-col gap-8 px-6 pb-12 pt-2">
        <section>
          <h1 className="font-serif text-[30px] font-medium leading-tight">{c.name}</h1>
          <p className="text-sm text-muted">
            {c.members.length} {c.members.length === 1 ? 'reader' : 'readers'}
            {c.limits.maxMembers ? ` · up to ${c.limits.maxMembers} on the free plan` : ''}
          </p>
          <ErrorText error={error} />
        </section>

        <section aria-labelledby="now-reading">
          <h2 id="now-reading" className="font-serif text-lg italic text-muted">
            Now reading
          </h2>
          {current.length === 0 ? (
            <div className="mt-2 rounded bg-panel p-4">
              <p className="text-[15px]">No book open yet.</p>
              {isHost && (
                <Link
                  href={`/clubs/${clubId}/rooms/new`}
                  className="mt-2 inline-flex min-h-11 items-center font-semibold"
                >
                  Open a reading room
                </Link>
              )}
            </div>
          ) : (
            current.map((r) => (
              <Link
                key={r.id}
                href={`/rooms/${r.id}`}
                className="mt-2 block rounded bg-paper p-4 text-ink no-underline hover:bg-highlight hover:text-ink"
              >
                <span className="block font-serif text-xl">{r.title}</span>
                {r.author && <span className="text-sm text-muted">{r.author}</span>}
              </Link>
            ))
          )}
        </section>

        {isHost && (
          <section aria-labelledby="invite">
            <h2 id="invite" className="font-serif text-lg italic text-muted">
              Invite friends
            </h2>
            <p className="mt-1 text-sm text-muted">
              Links work for 7 days. You can turn one off at any time.
            </p>
            {newLink && (
              <div className="mt-3 rounded bg-panel p-3">
                <label htmlFor="invite-link" className="text-sm font-semibold">
                  New invite link (shown once)
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="invite-link"
                    readOnly
                    value={newLink}
                    className="min-h-11 flex-1 rounded border border-rule bg-paper px-2 text-sm"
                  />
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(newLink).catch(() => undefined);
                      setCopied(true);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            )}
            <Button
              className="mt-3"
              onClick={() =>
                run(async () => {
                  const r = await api<{ url: string }>(`/clubs/${clubId}/invites`, {
                    method: 'POST',
                    json: {},
                  });
                  setNewLink(r.url);
                  setCopied(false);
                })
              }
            >
              Create invite link
            </Button>
            {invites.data && invites.data.invites.length > 0 && (
              <ul className="mt-3 divide-y divide-rule-soft text-sm">
                {invites.data.invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-2">
                    <span>
                      Expires {new Date(i.expiresAt).toLocaleDateString()} · used {i.uses}
                      {i.maxUses ? ` of ${i.maxUses}` : ''}
                    </span>
                    <Button
                      variant="quiet"
                      onClick={() => run(() => api(`/invites/${i.id}`, { method: 'DELETE' }))}
                    >
                      Turn off
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="members">
          <h2 id="members" className="font-serif text-lg italic text-muted">
            Readers
          </h2>
          <ul className="mt-2 divide-y divide-rule-soft">
            {c.members.map((m) => (
              <li key={m.id} className="flex min-h-14 items-center gap-3 py-2">
                <Avatar name={m.name} url={m.avatarUrl} size={36} />
                <Link href={`/profile/${m.id}`} className="flex-1 text-ink no-underline">
                  {m.name}
                  {m.id === me.id && ' (you)'}
                  {m.role === 'host' && <span className="ml-2 text-sm text-muted">host</span>}
                </Link>
                {isHost && m.id !== me.id && (
                  <span className="flex gap-1">
                    {m.role === 'member' && (
                      <Button
                        variant="quiet"
                        onClick={() =>
                          run(() =>
                            api(`/clubs/${clubId}/members/${m.id}`, {
                              method: 'PATCH',
                              json: { role: 'host' },
                            }),
                          )
                        }
                      >
                        Make host
                      </Button>
                    )}
                    <Button
                      variant="quiet"
                      onClick={() => {
                        if (confirm(`Remove ${m.name} from ${c.name}?`))
                          run(() => api(`/clubs/${clubId}/members/${m.id}`, { method: 'DELETE' }));
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isHost && reports.data && reports.data.reports.length > 0 && (
          <section aria-labelledby="reports">
            <h2 id="reports" className="font-serif text-lg italic text-muted">
              Reported thoughts
            </h2>
            <ul className="mt-2 flex flex-col gap-3">
              {reports.data.reports.map((r) => (
                <li key={r.reportId} className="rounded bg-panel p-3 text-sm">
                  <div className="font-semibold">
                    Chapter {r.position} · {r.reportCount}{' '}
                    {r.reportCount === 1 ? 'report' : 'reports'}
                  </div>
                  {r.reason && <div className="text-muted">Reason: {r.reason}</div>}
                  {r.body ? (
                    <blockquote className="mt-2 border-l-2 border-spine pl-3 font-serif text-base">
                      {r.authorName}: {r.body}
                    </blockquote>
                  ) : (
                    <p className="mt-2 italic text-muted">
                      This thought is beyond your bookmark, so it stays hidden from you. You can
                      still remove it.
                    </p>
                  )}
                  <div className="mt-2 flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() =>
                        run(() =>
                          api(`/moderation/reports/${r.reportId}`, {
                            method: 'POST',
                            json: { action: 'delete' },
                          }),
                        )
                      }
                    >
                      Delete thought
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() =>
                        run(() =>
                          api(`/moderation/reports/${r.reportId}`, {
                            method: 'POST',
                            json: { action: 'dismiss' },
                          }),
                        )
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {shelf.length > 0 && (
          <section aria-labelledby="shelf">
            <h2 id="shelf" className="font-serif text-lg italic text-muted">
              Shelf
            </h2>
            <ul className="mt-2 divide-y divide-rule-soft">
              {shelf.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/rooms/${r.id}`}
                    className="block py-3 font-serif text-lg text-ink no-underline"
                  >
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="you" className="border-t border-rule pt-6">
          <h2 id="you" className="font-serif text-lg italic text-muted">
            You in this club
          </h2>
          <label className="mt-3 flex min-h-11 items-center gap-3 text-[15px]">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={c.me.positionHidden}
              onChange={(e) =>
                run(() =>
                  api(`/clubs/${clubId}/me`, {
                    method: 'PATCH',
                    json: { positionHidden: e.target.checked },
                  }),
                )
              }
            />
            Hide where I am from other readers
          </label>
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => {
              if (confirm(`Leave ${c.name}?`))
                run(async () => {
                  await api(`/clubs/${clubId}/members/${me.id}`, { method: 'DELETE' });
                  router.push('/clubs');
                });
            }}
          >
            Leave club
          </Button>
        </section>
      </main>
    </Screen>
  );
}
