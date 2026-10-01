'use client';
import useSWR from 'swr';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { RoomDTO } from '@bookmarker/shared';
import { ApiError, fetcher } from './api';
import type { Me, NotificationItem } from './types';
import { getSocket } from './socket';

const opts = { revalidateOnFocus: true, shouldRetryOnError: false };

/** Signed-in user; sends anyone signed out to /signin. */
export function useMe() {
  const router = useRouter();
  const res = useSWR<Me>('/me', fetcher, opts);
  useEffect(() => {
    if (res.error instanceof ApiError && res.error.status === 401) {
      router.replace(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [res.error, router]);
  return res;
}

export function useRoom(roomId: string | undefined) {
  return useSWR<RoomDTO>(roomId ? `/rooms/${roomId}` : null, fetcher, opts);
}

/** Unread letters count, refreshed when the worker pings this tab. */
export function useNotifications() {
  const res = useSWR<{ unread: number; notifications: NotificationItem[] }>(
    '/notifications',
    fetcher,
    opts,
  );
  const { mutate } = res;
  useEffect(() => {
    const socket = getSocket();
    const onNew = () => void mutate();
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [mutate]);
  return res;
}
