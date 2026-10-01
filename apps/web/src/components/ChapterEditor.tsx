'use client';
import { CloseIcon, DownIcon, LockIcon, UpIcon } from './icons';

export interface EditableChapter {
  key: string;
  id?: string;
  title: string;
  /** At or below the furthest point any reader reached: rename only (decision #11). */
  frozen?: boolean;
}

let n = 0;
export const newKey = () => `new-${++n}`;

export function chaptersFromCount(count: number, titles?: string[] | null): EditableChapter[] {
  return Array.from({ length: count }, (_, i) => ({
    key: newKey(),
    title: titles?.[i] ?? `Chapter ${i + 1}`,
  }));
}

/**
 * Rename, reorder, add and remove chapters. Frozen chapters keep their place and
 * can only be renamed; nothing can be moved into or above them.
 */
export function ChapterEditor({
  chapters,
  onChange,
}: {
  chapters: EditableChapter[];
  onChange: (next: EditableChapter[]) => void;
}) {
  const frozenCount = chapters.filter((c) => c.frozen).length;
  const set = (i: number, patch: Partial<EditableChapter>) =>
    onChange(chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < frozenCount || j >= chapters.length) return;
    const next = [...chapters];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div>
      <ol className="divide-y divide-rule-soft border-y border-rule-soft">
        {chapters.map((c, i) => (
          <li key={c.key} className="flex items-center gap-2 py-1.5">
            <span className="w-7 text-right text-sm tabular-nums text-muted">{i + 1}</span>
            <input
              aria-label={`Title of chapter ${i + 1}`}
              value={c.title}
              maxLength={200}
              onChange={(e) => set(i, { title: e.target.value })}
              className="min-h-11 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 font-serif text-[17px] hover:border-rule focus:border-rule focus:bg-paper"
            />
            {c.frozen ? (
              <span
                className="flex w-[132px] items-center justify-end gap-1 pr-2 text-xs text-muted"
                title="Readers have reached this chapter"
              >
                <LockIcon /> fixed
              </span>
            ) : (
              <span className="flex">
                <button
                  type="button"
                  aria-label={`Move chapter ${i + 1} up`}
                  disabled={i <= frozenCount}
                  onClick={() => move(i, -1)}
                  className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
                >
                  <UpIcon />
                </button>
                <button
                  type="button"
                  aria-label={`Move chapter ${i + 1} down`}
                  disabled={i === chapters.length - 1}
                  onClick={() => move(i, 1)}
                  className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
                >
                  <DownIcon />
                </button>
                <button
                  type="button"
                  aria-label={`Remove chapter ${i + 1}`}
                  disabled={chapters.length <= 1}
                  onClick={() => onChange(chapters.filter((_, j) => j !== i))}
                  className="flex h-11 w-11 items-center justify-center disabled:opacity-30"
                >
                  <CloseIcon />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() =>
          onChange([...chapters, { key: newKey(), title: `Chapter ${chapters.length + 1}` }])
        }
        className="mt-2 min-h-11 font-semibold text-accent"
      >
        Add a chapter
      </button>
    </div>
  );
}
