'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { Button, ErrorText, Screen, TopBar } from '@/components/ui';

export default function NewClub() {
  useMe();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const club = await api<{ id: string }>('/clubs', { method: 'POST', json: { name } });
      router.push(`/clubs/${club.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar back="/clubs" />
      <main id="main" className="px-6 pt-4">
        <h1 className="font-serif text-[30px] font-medium">Start a club</h1>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label htmlFor="club-name" className="font-serif text-lg font-medium">
            What’s it called?
          </label>
          <input
            id="club-name"
            required
            minLength={3}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Thursday Readers"
            className="min-h-12 rounded border border-rule bg-paper px-3 text-base"
          />
          <p className="text-sm text-muted">
            3 to 60 characters. You’ll be the host; you can invite friends next.
          </p>
          <ErrorText error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create club'}
          </Button>
        </form>
      </main>
    </Screen>
  );
}
