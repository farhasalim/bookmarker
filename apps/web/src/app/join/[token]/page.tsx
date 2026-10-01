'use client';
import { use, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { ApiError, api, fetcher } from '@/lib/api';
import { Button, ErrorText, Loading, Screen } from '@/components/ui';

import { PENDING_INVITE } from '@/lib/constants';

/** Invite landing (FR-3): shows the club, then joins (signing in first if needed). */
export default function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const invite = useSWR<{ club: { name: string } }>(`/invites/${token}`, fetcher, {
    shouldRetryOnError: false,
  });
  const me = useSWR('/me', fetcher, { shouldRetryOnError: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function join() {
    if (me.error instanceof ApiError && me.error.status === 401) {
      try {
        localStorage.setItem(PENDING_INVITE, token);
      } catch {
        /* private mode: they can open the link again after signing in */
      }
      router.push('/signin');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ clubId: string }>(`/invites/${token}/accept`, { method: 'POST' });
      router.push(`/clubs/${r.clubId}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  if (invite.isLoading) return <Loading />;
  return (
    <Screen>
      <main id="main" className="flex flex-1 flex-col px-6 pt-16">
        <div aria-hidden className="ribbon h-10 w-6 bg-accent" />
        {invite.error ? (
          <>
            <h1 className="mt-6 font-serif text-3xl font-medium">This invite can’t be used</h1>
            <p className="mt-3 text-[15px]">
              {(invite.error as Error).message}. Ask the host for a new link.
            </p>
          </>
        ) : (
          <>
            <p className="mt-6 text-sm text-muted">You’re invited to</p>
            <h1 className="font-serif text-[34px] font-medium leading-tight">
              {invite.data?.club.name}
            </h1>
            <p className="mt-4 font-serif text-lg">
              Read at your own pace. You’ll only ever see thoughts from chapters you’ve reached.
            </p>
            <ErrorText error={error} />
            <Button className="mt-8" onClick={join} disabled={busy}>
              {busy ? 'Joining…' : 'Join the club'}
            </Button>
          </>
        )}
      </main>
    </Screen>
  );
}
