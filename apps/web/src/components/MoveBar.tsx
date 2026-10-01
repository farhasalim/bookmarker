'use client';
import { Button } from './ui';

export type PendingMove = { position: number; finished: boolean } | null;

/**
 * Moving the bookmark forward unlocks posts, so an accidental tap or drag must not
 * spoil anything: every move is confirmed here first. Moving back is safe but is
 * confirmed the same way for consistency.
 */
export function MoveBar({
  pending,
  current,
  waitingAt,
  busy,
  onConfirm,
  onCancel,
  focusConfirm = true,
}: {
  pending: PendingMove;
  current: { position: number; finished: boolean };
  waitingAt: (position: number) => number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** False while the reader is still dragging or arrowing the ribbon. */
  focusConfirm?: boolean;
}) {
  if (!pending) return null;
  const forward = pending.finished ? !current.finished : pending.position > current.position;
  const label = pending.finished
    ? 'Mark the book finished?'
    : pending.position === 0
      ? 'Move your bookmark back to the start?'
      : `Move your bookmark to chapter ${pending.position}?`;
  const waiting = !pending.finished && forward ? waitingAt(pending.position) : 0;
  return (
    <div
      role="dialog"
      aria-label="Confirm bookmark move"
      className="sticky bottom-0 z-10 border-t border-rule bg-paper px-6 pb-5 pt-4 shadow-[0_-6px_16px_rgba(0,0,0,0.06)]"
    >
      <p className="font-serif text-lg font-medium">{label}</p>
      <p className="text-sm text-muted">
        {pending.finished
          ? 'Every chapter, the After-the-book thoughts and other finishers’ reviews will open.'
          : forward
            ? `Only if you’ve finished it. ${waiting > 0 ? `${waiting} ${waiting === 1 ? 'thought is' : 'thoughts are'} waiting there.` : ''}`
            : 'Chapters after it will close again. Your own thoughts stay with you.'}
      </p>
      <div className="mt-3 flex gap-3">
        <Button onClick={onConfirm} disabled={busy} autoFocus={focusConfirm}>
          {busy ? 'Moving…' : pending.finished ? 'I’ve finished it' : 'Move bookmark'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
