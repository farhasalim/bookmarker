'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import useSWR from 'swr';
import type { ReviewDTO } from '@bookmarker/shared';
import { LIMITS } from '@bookmarker/shared';
import { api, fetcher } from '@/lib/api';
import { useMe, useRoom } from '@/lib/hooks';
import { StarIcon } from '@/components/icons';
import { Button, ErrorText, Loading, Screen, TopBar } from '@/components/ui';

const DAY = 24 * 60 * 60 * 1000;

/** Finish, rate and review (FR-15, FR-17): "Finishing feels earned." */
export default function Finish({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { data: me } = useMe();
  const room = useRoom(roomId);
  const mine = useSWR<{ review: ReviewDTO | null }>(
    room.data?.me.finished ? `/rooms/${roomId}/reviews/me` : null,
    fetcher,
  );
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ starsAwarded: string[] } | null>(null);

  useEffect(() => {
    const r = mine.data?.review;
    if (r) {
      setRating(r.rating);
      setBody(r.body ?? '');
      setIsPublic(r.isPublic);
    }
  }, [mine.data]);

  if (!room.data || !me) return <Loading />;
  const r = room.data;
  if (!r.me.finished) {
    return (
      <Screen>
        <TopBar back={`/rooms/${roomId}`} />
        <p className="p-6">Mark the book finished from the contents page first.</p>
      </Screen>
    );
  }
  const days = Math.max(1, Math.round((Date.now() - new Date(r.me.joinedAt).getTime()) / DAY));
  const finishers = r.friends.filter((f) => f.finished);
  const ordinal =
    ['first', 'second', 'third', 'fourth', 'fifth'][finishers.length] ??
    `${finishers.length + 1}th`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) return setError(new Error('Choose a rating from 1 to 5 first.'));
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ starsAwarded: string[] }>(`/rooms/${roomId}/reviews/me`, {
        method: 'PUT',
        json: { rating, ...(body.trim() ? { body } : {}), isPublic },
      });
      setResult(out);
      void mine.mutate();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const earned = result?.starsAwarded.length ?? 0;
  return (
    <Screen>
      <TopBar back={`/rooms/${roomId}`} />
      <section className="relative flex flex-col items-center gap-1.5 overflow-hidden bg-panel px-6 pb-6 pt-7 text-center">
        <div aria-hidden className="ribbon absolute right-8 top-0 h-12 w-6 bg-accent" />
        <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border-[3px] border-accent bg-paper">
          <StarIcon size={36} filled={earned > 0 || !!mine.data?.review} />
          {earned > 0 && (
            <div className="text-[13px] font-bold text-accent">
              +{earned} {earned === 1 ? 'star' : 'stars'}
            </div>
          )}
        </div>
        <h1 className="mt-2.5 font-serif text-[32px] font-medium leading-tight">
          Congratulations, {me.name.split(' ')[0]}!
        </h1>
        <p className="font-serif text-lg">
          You finished <i>{r.title}</i>.
        </p>
        <dl className="mt-2.5 grid w-full grid-cols-3 border-t border-rule pt-3">
          <div>
            <dd className="font-serif text-2xl font-medium">{r.chapterCount}</dd>
            <dt className="text-xs">chapters</dt>
          </div>
          <div className="border-x border-rule">
            <dd className="font-serif text-2xl font-medium">{days}</dd>
            <dt className="text-xs">{days === 1 ? 'day' : 'days'}</dt>
          </div>
          <div>
            <dd className="font-serif text-2xl font-medium">{r.me.postCount}</dd>
            <dt className="text-xs">thoughts shared</dt>
          </div>
        </dl>
      </section>
      <p className="border-b border-rule bg-panel-2 px-6 py-3 text-sm">
        You’re the {ordinal} in {r.clubName} to finish.
        {finishers.length > 0 && (
          <>
            {' '}
            <Link href={`/rooms/${roomId}/reviews`}>
              Reviews from {finishers.length === 1 ? finishers[0]!.name : 'the others'} are open to
              you.
            </Link>
          </>
        )}
      </p>

      <form onSubmit={save} className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-4">
        <fieldset>
          <legend className="mb-1 font-serif text-[19px] font-medium">
            How would you rate it?
          </legend>
          <div className="flex gap-0.5" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} of 5`}
                onClick={() => setRating(n)}
                className="flex h-[46px] w-[46px] items-center justify-center"
              >
                <StarIcon size={32} filled={n <= rating} />
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="review" className="font-serif text-[19px] font-medium">
              Write a review
            </label>
            <span className="text-[13px] font-bold text-accent">50+ characters earns a star</span>
          </div>
          <p className="rounded bg-panel px-3 py-2 text-[13px]">
            Please keep spoilers out. Friends who haven’t finished may see your review if you make
            it public.
          </p>
          <textarea
            id="review"
            rows={4}
            maxLength={LIMITS.reviewBody}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What will you remember about this book?"
            className="w-full resize-none rounded border border-rule bg-paper p-3 font-serif text-base leading-normal"
          />
          <span className="text-xs text-muted tabular-nums">{body.trim().length} characters</span>
        </div>
        <label className="flex min-h-11 items-start gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="mt-1 h-5 w-5 accent-[var(--accent)]"
          />
          <span>
            Make it public
            <span className="block text-[13px] text-muted">
              Shows on your profile and share card. Readers who haven’t finished must tap to reveal
              it.
            </span>
          </span>
        </label>
        <ErrorText error={error} />
        {result && (
          <p role="status" className="rounded bg-highlight p-3 text-sm">
            Saved to your shelf.
            {earned > 0
              ? ` You earned ${earned} ${earned === 1 ? 'star' : 'stars'}.`
              : ' (Stars come once per book, after you’ve been in the room for 3 days.)'}
          </p>
        )}
        <Button type="submit" disabled={busy} className="mt-auto min-h-12">
          {busy ? 'Saving…' : mine.data?.review ? 'Update my review' : 'Add to my shelf'}
        </Button>
      </form>
    </Screen>
  );
}
