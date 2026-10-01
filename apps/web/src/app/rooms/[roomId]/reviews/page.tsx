'use client';
import { use } from 'react';
import useSWR from 'swr';
import type { ReviewDTO } from '@bookmarker/shared';
import { ApiError, fetcher } from '@/lib/api';
import { useMe, useRoom } from '@/lib/hooks';
import { StarIcon } from '@/components/icons';
import { Loading, Screen, TopBar } from '@/components/ui';

/** Reviews are spoiler territory: only readers who finished (FR-16). */
export default function Reviews({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  useMe();
  const room = useRoom(roomId);
  const reviews = useSWR<{ reviews: ReviewDTO[] }>(`/rooms/${roomId}/reviews`, fetcher, {
    shouldRetryOnError: false,
  });
  if (!room.data) return <Loading />;
  const locked = reviews.error instanceof ApiError && reviews.error.code === 'NOT_FINISHED';
  return (
    <Screen>
      <TopBar back={`/rooms/${roomId}`} title={room.data.title} />
      <main id="main" className="px-6 pb-10 pt-2">
        <h1 className="font-serif text-[30px] font-medium">Reviews</h1>
        {locked ? (
          <p className="mt-4 rounded bg-panel p-4">Reviews open when you finish the book.</p>
        ) : reviews.data?.reviews.length === 0 ? (
          <p className="mt-4 font-serif text-lg italic text-muted">No reviews yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-5">
            {reviews.data?.reviews.map((r) => (
              <li key={r.user.id} className="border-b border-rule-soft pb-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {r.user.name}
                    {r.mine ? ' (you)' : ''}
                  </span>
                  <span className="flex" role="img" aria-label={`${r.rating} of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <StarIcon key={n} size={16} filled={n <= r.rating} />
                    ))}
                  </span>
                </div>
                {r.body && (
                  <p className="mt-2 whitespace-pre-wrap font-serif text-lg leading-normal">
                    {r.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </Screen>
  );
}
