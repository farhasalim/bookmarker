'use client';
import { Suspense, useState } from 'react';
import useSWR from 'swr';
import { useSearchParams } from 'next/navigation';
import { api, fetcher } from '@/lib/api';
import { Button, ErrorText, Screen, TopRow } from '@/components/ui';

const ERRORS: Record<string, string> = {
  link: 'That sign-in link has expired or was already used. Ask for a new one below.',
  google: 'Google sign-in did not finish. Try again, or use your email.',
  deleted: 'That account was deleted.',
};

function SignIn() {
  const params = useSearchParams();
  const { data: providers } = useSWR<{ google: boolean }>('/auth/providers', fetcher);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const urlError = params.get('error');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/magic-link', { method: 'POST', json: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopRow />
      <main id="main" className="flex flex-1 flex-col px-6 pt-6">
        <div aria-hidden className="ribbon h-10 w-6 bg-accent" />
        <h1 className="mt-6 font-serif text-[34px] font-medium leading-tight">
          Sign in to BookMarker
        </h1>
        {urlError && (
          <p role="alert" className="mt-4 rounded bg-panel p-3 text-sm">
            {ERRORS[urlError] ?? 'Sign-in did not work. Try again.'}
          </p>
        )}

        {providers?.google && (
          <a
            href="/api/v1/auth/google"
            className="mt-8 flex min-h-12 items-center justify-center rounded border border-rule bg-paper font-semibold text-ink no-underline hover:bg-panel"
          >
            Continue with Google
          </a>
        )}

        {sent ? (
          <div className="mt-8 rounded bg-panel p-4" role="status">
            <h2 className="font-serif text-xl font-medium">Check your email</h2>
            <p className="mt-1 text-[15px]">
              We sent a sign-in link to <b>{email}</b>. It works once and expires in 15 minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
            <label htmlFor="email" className="font-serif text-lg font-medium">
              {providers?.google ? 'Or get a link by email' : 'Get a sign-in link by email'}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 rounded border border-rule bg-paper px-3 text-base"
              placeholder="you@example.com"
            />
            <ErrorText error={error} />
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Email me a link'}
            </Button>
            <p className="text-sm text-muted">
              No passwords. We only use your email to sign you in and send the reminders you choose.
            </p>
          </form>
        )}
      </main>
    </Screen>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
