/**
 * Quiet hours 22:00–07:00 in the reader's own time zone (PRD, Notifications).
 * Email that would land in quiet hours is held until 07:00 local.
 */
export const QUIET_START = 22;
export const QUIET_END = 7;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

export function localHour(at: Date, timeZone: string): number {
  return localParts(at, timeZone).hour;
}

export function localWeekday(at: Date, timeZone: string): string {
  return localParts(at, timeZone).weekday; // "Sun", "Mon", ...
}

export function inQuietHours(at: Date, timeZone: string): boolean {
  const h = localHour(at, timeZone);
  return h >= QUIET_START || h < QUIET_END;
}

/** The next moment that is outside quiet hours (to the minute), or `at` itself. */
export function nextSendableTime(at: Date, timeZone: string): Date {
  if (!inQuietHours(at, timeZone)) return at;
  const { hour, minute } = localParts(at, timeZone);
  const hoursUntil7 = hour >= QUIET_START ? 24 - hour + QUIET_END : QUIET_END - hour;
  return new Date(at.getTime() + (hoursUntil7 * 60 - minute) * 60_000);
}
