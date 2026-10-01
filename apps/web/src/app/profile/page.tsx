'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/lib/hooks';
import { Loading } from '@/components/ui';

export default function MyProfile() {
  const { data } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (data) router.replace(`/profile/${data.id}`);
  }, [data, router]);
  return <Loading />;
}
