/**
 * Run worker jobs once, now, without Redis. For operators and tests:
 *
 *   pnpm --filter @bookmarker/worker once deliver
 *   pnpm --filter @bookmarker/worker once all --at=2026-10-04T04:30:00Z
 *   pnpm --filter @bookmarker/worker once deliver --in=31m
 */
import { pino } from 'pino';
import { createDb } from '@bookmarker/db';
import { mailerFromUrl } from '@bookmarker/mail';
import type { JobContext } from './context.ts';
import { deliverDue, emailDelivered } from './jobs/deliver.ts';
import { runReminders } from './jobs/reminders.ts';
import { runWeekly } from './jobs/weekly.ts';

const args = process.argv.slice(2);
const job = args.find((a) => !a.startsWith('--')) ?? 'all';
const at = args.find((a) => a.startsWith('--at='))?.slice(5);
const inArg = args.find((a) => a.startsWith('--in='))?.slice(5);
const offsetMs = inArg
  ? Number.parseInt(inArg, 10) *
    ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[inArg.slice(-1)] ?? 60_000)
  : 0;
const now = at ? new Date(at) : new Date(Date.now() + offsetMs);

const db = createDb();
const ctx: JobContext = {
  db,
  logger: pino({ level: 'info' }),
  mailer: mailerFromUrl(
    process.env.SMTP_URL ?? 'smtp://localhost:1025',
    process.env.EMAIL_FROM ?? 'BookMarker <hello@bookmarker.local>',
  ),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  ping: async () => {},
};

const out: Record<string, unknown> = { now: now.toISOString() };
if (job === 'deliver' || job === 'all') {
  out.deliver = await deliverDue(ctx, now);
  out.emails = await emailDelivered(ctx, now);
}
if (job === 'reminders' || job === 'all') out.reminders = await runReminders(ctx, now);
if (job === 'weekly' || job === 'all') out.weekly = await runWeekly(ctx, now);
console.log(JSON.stringify(out));
await db.$disconnect();
