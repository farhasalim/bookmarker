'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationPrefs } from '@bookmarker/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { Button, ErrorText, Loading, Screen, TopBar } from '@/components/ui';

const CHANNELS: Array<{
  label: string;
  inApp: keyof NotificationPrefs;
  email: keyof NotificationPrefs;
  note: string;
}> = [
  {
    label: 'New thoughts in chapters you’ve reached',
    inApp: 'postsInApp',
    email: 'postsEmail',
    note: 'Sent in batches every 30 minutes.',
  },
  {
    label: 'Replies to your thoughts',
    inApp: 'repliesInApp',
    email: 'repliesEmail',
    note: 'Straight away.',
  },
  {
    label: 'Reading reminders',
    inApp: 'remindersInApp',
    email: 'remindersEmail',
    note: 'Only when you haven’t moved your bookmark.',
  },
  {
    label: 'Weekly “where everyone is”',
    inApp: 'weeklyInApp',
    email: 'weeklyEmail',
    note: 'Sundays at 10:00, chapter numbers only.',
  },
];

/** Settings (FR-20, SEC-11): channels, cadence, time zone, export, delete. */
export default function Settings() {
  const router = useRouter();
  const { data: me, mutate } = useMe();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'UTC'];
    }
  }, []);

  useEffect(() => {
    if (me) {
      setName(me.name);
      setTimezone(me.timezone);
    }
  }, [me]);
  if (!me) return <Loading />;

  const patch = async (json: object, msg = 'Saved') => {
    setError(null);
    setSaved(null);
    try {
      await api('/me', { method: 'PATCH', json });
      await mutate();
      setSaved(msg);
    } catch (e) {
      setError(e);
    }
  };
  const prefs = me.notificationPrefs;

  return (
    <Screen>
      <TopBar back={`/profile/${me.id}`} title="Settings" />
      <main id="main" className="flex flex-col gap-8 px-6 pb-16 pt-2">
        <h1 className="font-serif text-[30px] font-medium">Settings</h1>
        <div aria-live="polite" className="min-h-5 text-sm">
          {saved}
        </div>
        <ErrorText error={error} />

        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-xl font-medium">You</h2>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Name</span>
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="min-h-11 rounded border border-rule bg-paper px-3"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">Time zone</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="min-h-11 rounded border border-rule bg-paper px-2"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              Used for quiet hours (22:00–07:00) and the Sunday update.
            </span>
          </label>
          <Button onClick={() => patch({ name, timezone })} className="self-start">
            Save
          </Button>
        </section>

        <section id="notifications" className="flex flex-col gap-3">
          <h2 className="font-serif text-xl font-medium">Notifications</h2>
          <p className="text-sm text-muted">
            You only ever hear about chapters you’ve reached. Emails never include what anyone
            wrote.
          </p>
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="text-xs text-muted">
                <th className="py-2 font-normal">What</th>
                <th className="w-16 py-2 text-center font-normal">In app</th>
                <th className="w-16 py-2 text-center font-normal">Email</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((c) => (
                <tr key={c.label} className="border-t border-rule-soft">
                  <td className="py-2.5 pr-2">
                    {c.label}
                    <div className="text-xs text-muted">{c.note}</div>
                  </td>
                  {[c.inApp, c.email].map((k) => (
                    <td key={k} className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${c.label}: ${k.endsWith('Email') ? 'email' : 'in app'}`}
                        checked={Boolean(prefs[k])}
                        onChange={(e) => patch({ notificationPrefs: { [k]: e.target.checked } })}
                        className="h-5 w-5 accent-[var(--accent)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <label className="flex items-center gap-3 text-[15px]">
            Remind me every
            <select
              value={prefs.reminderEveryDays}
              onChange={(e) =>
                patch({ notificationPrefs: { reminderEveryDays: Number(e.target.value) } })
              }
              className="min-h-11 rounded border border-rule bg-paper px-2"
            >
              {[3, 4, 5, 7, 10, 14].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            To hide where you are from friends, use the setting on each club’s page.
          </p>
        </section>

        <section className="flex flex-col gap-3 border-t border-rule pt-6">
          <h2 className="font-serif text-xl font-medium">Your data</h2>
          <a href="/api/v1/me/export" className="font-semibold">
            Download everything you’ve written (JSON)
          </a>
          <Button
            variant="outline"
            className="self-start"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' });
              router.push('/');
            }}
          >
            Sign out
          </Button>
          <div className="mt-4 rounded border border-danger p-4">
            <h3 className="font-semibold text-danger">Delete my account</h3>
            <p className="mt-1 text-sm">
              Your account and email go. Your thoughts stay in your clubs as “Former member” so
              discussions still make sense. This can’t be undone.
            </p>
            <label className="mt-3 flex flex-col gap-1 text-sm">
              Type <b>delete</b> to confirm
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="min-h-11 rounded border border-rule bg-paper px-2"
              />
            </label>
            <Button
              variant="danger"
              className="mt-3"
              disabled={confirmText !== 'delete'}
              onClick={async () => {
                try {
                  await api('/me', { method: 'DELETE' });
                  router.push('/');
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Delete my account
            </Button>
          </div>
        </section>
      </main>
    </Screen>
  );
}
