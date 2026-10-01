/**
 * Book lookup via Open Library (FR-4), cached 24 h. Behind an interface so tests
 * (and a future provider) can swap it. Open Library rarely knows chapter counts,
 * so `chapterTitles` is filled only when an edition lists a table of contents.
 */
export interface BookHit {
  title: string;
  author: string | null;
  isbn: string | null;
  coverUrl: string | null;
  chapterTitles: string[] | null;
}

export interface BookSearch {
  search(q: string): Promise<BookHit[]>;
}

type Cache = { get(k: string): Promise<string | null>; set(k: string, v: string, ttlSeconds: number): Promise<void> };

export function memoryCache(): Cache {
  const m = new Map<string, { v: string; until: number }>();
  return {
    async get(k) {
      const e = m.get(k);
      return e && e.until > Date.now() ? e.v : null;
    },
    async set(k, v, ttl) {
      m.set(k, { v, until: Date.now() + ttl * 1000 });
    },
  };
}

interface OLDoc {
  title?: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  edition_key?: string[];
}

export function openLibrary(cache: Cache, fetchImpl: typeof fetch = fetch): BookSearch {
  async function tocFor(editionKey: string | undefined): Promise<string[] | null> {
    if (!editionKey) return null;
    try {
      const res = await fetchImpl(`https://openlibrary.org/books/${editionKey}.json`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      const ed = (await res.json()) as { table_of_contents?: Array<{ title?: string; label?: string }> };
      const titles = (ed.table_of_contents ?? [])
        .map((t) => (t.title ?? t.label ?? '').trim())
        .filter((t) => t.length > 0);
      return titles.length >= 2 ? titles.slice(0, 500) : null;
    } catch {
      return null;
    }
  }

  return {
    async search(q) {
      const key = `books:${q.toLowerCase().trim()}`;
      const hit = await cache.get(key);
      if (hit) return JSON.parse(hit) as BookHit[];

      const isIsbn = /^[\d-]{10,17}$/.test(q.trim());
      const url = new URL('https://openlibrary.org/search.json');
      url.searchParams.set(isIsbn ? 'isbn' : 'q', q.trim());
      url.searchParams.set('limit', '8');
      url.searchParams.set('fields', 'title,author_name,isbn,cover_i,edition_key');
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'BookMarker (book club app)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { docs?: OLDoc[] };
      const docs = (body.docs ?? []).slice(0, 8);
      const results: BookHit[] = await Promise.all(
        docs.map(async (doc, i) => ({
          title: doc.title ?? 'Untitled',
          author: doc.author_name?.[0] ?? null,
          isbn: doc.isbn?.[0] ?? null,
          coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
          // Only look up a table of contents for the top 3 results, to stay fast.
          chapterTitles: i < 3 ? await tocFor(doc.edition_key?.[0]) : null,
        })),
      );
      await cache.set(key, JSON.stringify(results), 24 * 60 * 60);
      return results;
    },
  };
}
