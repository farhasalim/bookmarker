'use client';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import type { BookHit } from '@/lib/types';
import { ChapterEditor, chaptersFromCount, type EditableChapter } from '@/components/ChapterEditor';
import { Button, ErrorText, Screen, TopBar } from '@/components/ui';

/** Host opens a reading room (FR-4) and sets the chapter list (FR-5, decision #11). */
export default function NewRoom({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = use(params);
  useMe();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<BookHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [book, setBook] = useState<{
    title: string;
    author: string;
    coverUrl?: string;
    isbn?: string;
  } | null>(null);
  const [toc, setToc] = useState<string[] | null>(null);
  const [count, setCount] = useState(20);
  const [chapters, setChapters] = useState<EditableChapter[]>(chaptersFromCount(20));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const r = await api<{ results: BookHit[] }>(`/books/search?q=${encodeURIComponent(q)}`);
      setResults(r.results);
    } catch (err) {
      setError(err);
    } finally {
      setSearching(false);
    }
  }

  function pick(hit: BookHit) {
    setBook({
      title: hit.title,
      author: hit.author ?? '',
      ...(hit.coverUrl ? { coverUrl: hit.coverUrl } : {}),
      ...(hit.isbn ? { isbn: hit.isbn } : {}),
    });
    setToc(hit.chapterTitles);
    const c = hit.chapterTitles?.length ?? 20;
    setCount(c);
    setChapters(chaptersFromCount(c, hit.chapterTitles));
  }

  async function create(confirm: boolean) {
    if (!book) return;
    setBusy(true);
    setError(null);
    try {
      const room = await api<{ id: string }>(`/clubs/${clubId}/rooms`, {
        method: 'POST',
        json: {
          title: book.title,
          ...(book.author ? { author: book.author } : {}),
          ...(book.coverUrl ? { coverUrl: book.coverUrl } : {}),
          ...(book.isbn ? { isbn: book.isbn } : {}),
          chapters: chapters.map((c) => ({ title: c.title.trim() || 'Untitled' })),
        },
      });
      if (confirm) {
        const draft = await api<{ chapters: Array<{ id: string; title: string; kind: string }> }>(
          `/rooms/${room.id}`,
        );
        await api(`/rooms/${room.id}/chapters`, {
          method: 'PUT',
          json: {
            chapters: draft.chapters
              .filter((c) => c.kind === 'chapter')
              .map((c) => ({ id: c.id, title: c.title })),
            confirm: true,
          },
        });
        router.push(`/rooms/${room.id}`);
      } else {
        router.push(`/rooms/${room.id}/setup`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar back={`/clubs/${clubId}`} title="New reading room" />
      <main id="main" className="flex flex-col gap-8 px-6 pb-16 pt-2">
        <section>
          <h1 className="font-serif text-[30px] font-medium">Which book?</h1>
          <form onSubmit={search} className="mt-4 flex gap-2">
            <label htmlFor="book-q" className="sr-only">
              Title, author or ISBN
            </label>
            <input
              id="book-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              minLength={2}
              placeholder="Title, author or ISBN"
              className="min-h-12 flex-1 rounded border border-rule bg-paper px-3"
            />
            <Button type="submit" disabled={searching || q.trim().length < 2}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </form>
          {results && (
            <ul className="mt-3 divide-y divide-rule-soft border-y border-rule-soft">
              {results.length === 0 && (
                <li className="py-3 text-sm">No matches. Enter it by hand below.</li>
              )}
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pick(r)}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left hover:bg-highlight"
                  >
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt="" className="h-14 w-10 rounded-sm object-cover" />
                    ) : (
                      <span aria-hidden className="h-14 w-10 rounded-sm bg-panel" />
                    )}
                    <span>
                      <span className="block font-serif text-lg leading-tight">{r.title}</span>
                      <span className="text-sm text-muted">
                        {r.author ?? 'Unknown author'}
                        {r.chapterTitles ? ` · ${r.chapterTitles.length} chapters listed` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="mt-3 min-h-11 font-semibold text-accent"
            onClick={() => setBook({ title: q, author: '' })}
          >
            Enter the book by hand
          </button>
        </section>

        {book && (
          <section className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Title</span>
              <input
                value={book.title}
                onChange={(e) => setBook({ ...book, title: e.target.value })}
                required
                className="min-h-12 rounded border border-rule bg-paper px-3 font-serif text-lg"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Author</span>
              <input
                value={book.author}
                onChange={(e) => setBook({ ...book, author: e.target.value })}
                className="min-h-12 rounded border border-rule bg-paper px-3"
              />
            </label>

            <h2 className="mt-4 font-serif text-2xl font-medium">Chapters</h2>
            <p className="text-sm text-muted">
              Use your club’s edition.{' '}
              {toc
                ? 'Open Library listed these chapter titles; check them against your copy.'
                : 'Open Library doesn’t list chapters for this book, so set the count yourself.'}
            </p>
            <label className="flex items-center gap-3">
              <span className="text-sm font-semibold">How many chapters?</span>
              <input
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => {
                  const c = Math.max(1, Math.min(500, Number(e.target.value) || 1));
                  setCount(c);
                  setChapters(chaptersFromCount(c, toc));
                }}
                className="min-h-11 w-24 rounded border border-rule bg-paper px-2"
              />
            </label>
            <ChapterEditor chapters={chapters} onChange={setChapters} />

            <div className="mt-4 rounded bg-panel p-4 text-[15px]">
              <b>Confirming makes the list final.</b> After that, chapters can only be added,
              removed or moved after the furthest point anyone has read. Renaming is always fine.
            </div>
            <ErrorText error={error} />
            <Button disabled={busy || !book.title.trim()} onClick={() => create(true)}>
              Confirm chapters and open the room
            </Button>
            <Button
              variant="outline"
              disabled={busy || !book.title.trim()}
              onClick={() => create(false)}
            >
              Save as a draft
            </Button>
          </section>
        )}
      </main>
    </Screen>
  );
}
