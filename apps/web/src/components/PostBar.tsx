'use client';
import { useEffect, useRef, useState } from 'react';
import type { FriendPosition, PostDTO } from '@bookmarker/shared';
import { LIMITS } from '@bookmarker/shared';
import { api } from '@/lib/api';
import { listNames } from '@/lib/format';
import { Button, ErrorText } from './ui';

/**
 * The post bar lives at the reader's bookmark (MVP-6). It says who will see the
 * thought: friends at or past this chapter now, the rest when they get here.
 * Readers who hide their position are not in `friends`, so they are never named.
 */
export function PostBar({
  chapterId,
  position,
  afterBook,
  friends,
  onPosted,
  rows = 2,
  showAudience = false,
}: {
  chapterId: string;
  position: number;
  afterBook: boolean;
  friends: FriendPosition[];
  onPosted: (p: PostDTO) => void;
  rows?: number;
  showAudience?: boolean;
}) {
  const [body, setBody] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // Text typed before the page finished loading its script is in the box but
  // not in state yet; pick it up so the Post button isn't left disabled.
  useEffect(() => {
    const typed = box.current?.value;
    if (typed) setBody(typed);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const where = afterBook ? 'after the book' : `at chapter ${position}`;
  const now = friends
    .filter((f) => f.finished || (!afterBook && f.position >= position))
    .map((f) => f.name);
  const later = friends
    .filter((f) => !(f.finished || (!afterBook && f.position >= position)))
    .map((f) => f.name);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const post = await api<PostDTO>(`/chapters/${chapterId}/posts`, {
        method: 'POST',
        json: { body },
      });
      setBody('');
      onPosted(post);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="relative flex flex-col gap-2.5 border-t border-rule bg-panel px-6 pb-5 pt-3.5"
    >
      <div aria-hidden className="ribbon absolute -top-px right-7 h-[30px] w-4 bg-accent" />
      <label htmlFor="post-body" className="font-serif text-[17px] font-medium">
        Your thought {where}
      </label>
      <textarea
        id="post-body"
        ref={box}
        rows={rows}
        maxLength={LIMITS.postBody}
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What stayed with you?"
        className="w-full resize-none rounded border border-rule bg-paper px-3 py-2.5 font-serif text-base leading-relaxed"
      />
      {showAudience && (now.length > 0 || later.length > 0) && (
        <p className="font-serif text-sm italic leading-snug text-muted">
          {now.length > 0 ? `${listNames(now)} will see this now.` : 'Nobody else is here yet.'}
          {later.length > 0 ? ` ${listNames(later)}, when they get here.` : ''}
        </p>
      )}
      <ErrorText error={error} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {showAudience ? (
            <span className="tabular-nums">
              {body.length.toLocaleString()} of {LIMITS.postBody.toLocaleString()}
            </span>
          ) : afterBook ? (
            'Seen only by friends who have finished'
          ) : (
            `Seen only by friends at chapter ${position} or beyond`
          )}
        </span>
        <Button type="submit" disabled={busy || body.trim().length === 0} className="shrink-0">
          {busy
            ? 'Posting…'
            : showAudience
              ? `Post ${afterBook ? 'after the book' : `at chapter ${position}`}`
              : 'Post'}
        </Button>
      </div>
    </form>
  );
}
