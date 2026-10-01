const DAY = 24 * 60 * 60 * 1000;

/**
 * When the next reading reminder is due (FR-13): `everyDays` after the later of
 * the last bookmark move and the last reminder. Moving the bookmark pushes it back,
 * which is what "skipped if they moved since the last reminder" means in practice.
 */
export function reminderDue(movedAt: Date, lastReminderAt: Date | null, everyDays: number): Date {
  const from = lastReminderAt && lastReminderAt > movedAt ? lastReminderAt : movedAt;
  return new Date(from.getTime() + everyDays * DAY);
}

/** ISO-8601 week key like "2026-W40", for one-weekly-update-per-week dedupe. */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
