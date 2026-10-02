import { z } from 'zod';

/** Request bodies, validated on every endpoint (SEC-7). */

export const LIMITS = {
  postBody: 1000,
  replyBody: 1000,
  reviewBody: 5000,
  reviewStarMinChars: 50,
  clubName: { min: 3, max: 60 },
  maxChapters: 500,
  pageSize: 50,
} as const;

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const MagicLinkRequest = z.object({ email: z.email().max(254) });

export const CreateClub = z.object({
  name: trimmed(LIMITS.clubName.min, LIMITS.clubName.max),
  description: z.string().trim().max(500).optional(),
});
export const UpdateClub = CreateClub.partial();

export const CreateInvite = z.object({
  expiresInDays: z.number().int().min(1).max(7).default(7),
  maxUses: z.number().int().min(1).max(100).optional(),
});

export const ChapterInput = z.object({
  /** Existing chapter id when keeping/renaming; omit for a new chapter. */
  id: z.uuid().optional(),
  title: trimmed(1, 200),
});

export const CreateRoom = z.object({
  title: trimmed(1, 300),
  author: z.string().trim().max(300).optional(),
  coverUrl: z.url().max(1000).optional(),
  isbn: z.string().trim().max(20).optional(),
  chapters: z
    .array(ChapterInput.omit({ id: true }))
    .min(1)
    .max(LIMITS.maxChapters),
});

export const ReplaceChapters = z.object({
  chapters: z.array(ChapterInput).min(1).max(LIMITS.maxChapters),
  /** Host confirms the list is final (decision #11). Cannot be undone. */
  confirm: z.boolean().optional(),
});

export const SetBookmark = z.object({
  position: z.number().int().min(0),
  finished: z.boolean().default(false),
});

export const CreatePost = z.object({ body: trimmed(1, LIMITS.postBody) });
export const EditPost = CreatePost;
export const CreateReply = z.object({ body: trimmed(1, LIMITS.replyBody) });

export const UpsertReview = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(LIMITS.reviewBody).optional(),
  isPublic: z.boolean().default(false),
});

export const CreateReport = z.object({
  postId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});

export const Moderate = z.object({ action: z.literal('delete') });

export const Pagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSize).default(20),
});

/** FR-20: every channel can be switched off; reminder cadence adjustable. */
/**
 * Notification switches. Decision (Farha, 2 Oct 2026; SRS addendum): notifications
 * are in-app by default and email is used only for sign-in. Each email switch
 * stays in Settings so a reader can opt in.
 */
export const NotificationPrefs = z.object({
  postsInApp: z.boolean().default(true),
  postsEmail: z.boolean().default(false),
  repliesInApp: z.boolean().default(true),
  repliesEmail: z.boolean().default(false),
  remindersInApp: z.boolean().default(true),
  remindersEmail: z.boolean().default(false),
  weeklyInApp: z.boolean().default(true),
  weeklyEmail: z.boolean().default(false),
  reminderEveryDays: z.number().int().min(3).max(14).default(3),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export function readPrefs(raw: unknown): NotificationPrefs {
  const parsed = NotificationPrefs.safeParse(raw ?? {});
  return parsed.success ? parsed.data : NotificationPrefs.parse({});
}

export const UpdateMe = z.object({
  name: trimmed(1, 80).optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone')
    .optional(),
  notificationPrefs: NotificationPrefs.partial().optional(),
});

export const UpdateMembership = z.object({ positionHidden: z.boolean() });
