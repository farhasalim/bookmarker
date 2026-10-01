'use client';
import { useState } from 'react';
import useSWR from 'swr';
import type { PostDTO, ReplyDTO } from '@bookmarker/shared';
import { LIMITS } from '@bookmarker/shared';
import { api, fetcher } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { Button, ErrorText } from './ui';

/** One thought, with likes, one level of replies, and author/host/report actions. */
export function PostCard({
  post,
  isHost,
  onChanged,
}: {
  post: PostDTO;
  isHost: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const replies = useSWR<{ replies: ReplyDTO[] }>(
    open ? `/posts/${post.id}/replies` : null,
    fetcher,
  );
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
      onChanged();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <article
      className="flex flex-col gap-2 border-b border-rule-soft px-6 py-[18px]"
      aria-labelledby={`p-${post.id}`}
    >
      <div className="flex items-baseline justify-between">
        <h3 id={`p-${post.id}`} className="text-sm font-bold">
          {post.author.name}
          {post.mine && <span className="font-normal text-muted"> (you)</span>}
        </h3>
        <span className="text-xs text-muted">
          {timeAgo(post.createdAt)}
          {post.editedAt ? ' · edited' : ''}
        </span>
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api(`/posts/${post.id}`, { method: 'PATCH', json: { body: draft } }),
              () => setEditing(false),
            );
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`edit-${post.id}`} className="sr-only">
            Edit your thought
          </label>
          <textarea
            id={`edit-${post.id}`}
            value={draft}
            maxLength={LIMITS.postBody}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="rounded border border-rule bg-paper p-2 font-serif text-base"
          />
          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap font-serif text-lg leading-normal">{post.body}</p>
      )}
      <div className="flex flex-wrap gap-x-5 text-[13px]">
        <button
          type="button"
          aria-pressed={post.likedByMe}
          onClick={() =>
            act(() => api(`/posts/${post.id}/like`, { method: post.likedByMe ? 'DELETE' : 'PUT' }))
          }
          className={`min-h-11 ${post.likedByMe ? 'font-semibold text-accent' : 'text-muted'}`}
        >
          {post.likedByMe ? 'Liked' : 'Like'}
          {post.likeCount > 0 ? ` · ${post.likeCount}` : ''}
        </button>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="min-h-11 text-muted"
        >
          {post.replyCount === 0
            ? 'Reply'
            : `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`}
        </button>
        {post.mine && !editing && (
          <>
            <button type="button" className="min-h-11 text-muted" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="min-h-11 text-muted"
              onClick={() =>
                confirm('Delete this thought?') &&
                act(() => api(`/posts/${post.id}`, { method: 'DELETE' }))
              }
            >
              Delete
            </button>
          </>
        )}
        {!post.mine && isHost && (
          <button
            type="button"
            className="min-h-11 text-muted"
            onClick={() =>
              confirm('Delete this thought for everyone?') &&
              act(() =>
                api(`/moderation/posts/${post.id}`, { method: 'POST', json: { action: 'delete' } }),
              )
            }
          >
            Remove
          </button>
        )}
        {!post.mine && (
          <button
            type="button"
            className="min-h-11 text-muted"
            onClick={() => {
              const reason = prompt('What’s wrong with it? (optional)') ?? undefined;
              void act(
                () =>
                  api('/reports', {
                    method: 'POST',
                    json: { postId: post.id, ...(reason ? { reason } : {}) },
                  }),
                () => setNotice('Reported to the hosts.'),
              );
            }}
          >
            Report
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      <ErrorText error={error} />
      {open && (
        <div className="ml-3.5 flex flex-col gap-3 border-l-2 border-spine pl-3.5">
          {replies.data?.replies.map((r) => (
            <div key={r.id} className="flex flex-col gap-1">
              <div className="text-[13px] font-bold">{r.author.name}</div>
              <p className="whitespace-pre-wrap font-serif text-base leading-snug">{r.body}</p>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () => api(`/posts/${post.id}/replies`, { method: 'POST', json: { body: reply } }),
                () => {
                  setReply('');
                  void replies.mutate();
                },
              );
            }}
            className="flex gap-2"
          >
            <label htmlFor={`reply-${post.id}`} className="sr-only">
              Reply to {post.author.name}
            </label>
            <input
              id={`reply-${post.id}`}
              value={reply}
              maxLength={LIMITS.replyBody}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply…"
              className="min-h-11 flex-1 rounded border border-rule bg-paper px-2 font-serif"
            />
            <Button type="submit" variant="outline" disabled={!reply.trim()}>
              Reply
            </Button>
          </form>
        </div>
      )}
    </article>
  );
}
