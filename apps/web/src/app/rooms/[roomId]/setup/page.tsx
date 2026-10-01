'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe, useRoom } from '@/lib/hooks';
import { ChapterEditor, type EditableChapter } from '@/components/ChapterEditor';
import { Button, ErrorText, Loading, Screen, TopBar } from '@/components/ui';

/** Host edits chapters (FR-5); confirmed rooms are frozen up to the furthest reader. */
export default function Setup({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  useMe();
  const router = useRouter();
  const room = useRoom(roomId);
  const [chapters, setChapters] = useState<EditableChapter[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (room.data && !chapters) {
      setChapters(
        room.data.chapters
          .filter((c) => c.kind === 'chapter')
          .map((c) => ({
            key: c.id,
            id: c.id,
            title: c.title,
            frozen: room.data!.chaptersConfirmed && c.position <= room.data!.frozenThrough,
          })),
      );
    }
  }, [room.data, chapters]);

  if (!room.data || !chapters) return <Loading />;
  if (!room.data.me.isHost)
    return (
      <Screen>
        <TopBar back={`/rooms/${roomId}`} />
        <p className="p-6">Only a host can edit the chapters.</p>
      </Screen>
    );

  async function save(confirm: boolean) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const fresh = await api<typeof room.data>(`/rooms/${roomId}/chapters`, {
        method: 'PUT',
        json: {
          chapters: chapters!.map((c) => ({
            ...(c.id ? { id: c.id } : {}),
            title: c.title.trim() || 'Untitled',
          })),
          confirm,
        },
      });
      await room.mutate(fresh, { revalidate: false });
      setChapters(null); // rebuild from the server's answer
      setSaved(true);
      if (confirm) router.push(`/rooms/${roomId}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const confirmed = room.data.chaptersConfirmed;
  return (
    <Screen>
      <TopBar back={`/rooms/${roomId}`} title={room.data.title} />
      <main id="main" className="flex flex-col gap-4 px-6 pb-16 pt-2">
        <h1 className="font-serif text-[30px] font-medium">Chapters</h1>
        {confirmed ? (
          <p className="text-[15px] text-muted">
            {room.data.frozenThrough > 0
              ? `Chapters 1–${room.data.frozenThrough} are fixed because readers have reached them. You can rename any chapter, and change the ones after ${room.data.frozenThrough}.`
              : 'Nobody has started yet, so you can still change everything.'}
          </p>
        ) : (
          <p className="text-[15px] text-muted">
            This is a draft. Readers can’t move their bookmark until you confirm.
          </p>
        )}
        <ChapterEditor chapters={chapters} onChange={setChapters} />
        <ErrorText error={error} />
        {saved && (
          <p role="status" className="text-sm">
            Saved.
          </p>
        )}
        <Button
          disabled={busy}
          onClick={() => save(false)}
          variant={confirmed ? 'primary' : 'outline'}
        >
          Save chapters
        </Button>
        {!confirmed && (
          <Button disabled={busy} onClick={() => save(true)}>
            Confirm chapters and open the room
          </Button>
        )}
      </main>
    </Screen>
  );
}
