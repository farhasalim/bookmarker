import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createDb } from '@bookmarker/db';
import { mailerFromUrl } from '@bookmarker/mail';
import type { JobContext } from './context.ts';
import { deliverDue, emailDelivered } from './jobs/deliver.ts';
import { runReminders } from './jobs/reminders.ts';
import { runWeekly } from './jobs/weekly.ts';

/**
 * The background worker. BullMQ job schedulers fire each job on a fixed interval;
 * every job is idempotent and works from database state, so a missed or doubled
 * run is harmless.
 */
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'worker' } });
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required for the worker');
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const pub = new Redis(redisUrl);
const db = createDb();

const ctx: JobContext = {
  db,
  logger,
  mailer: mailerFromUrl(
    process.env.SMTP_URL ?? 'smtp://localhost:1025',
    process.env.EMAIL_FROM ?? 'BookMarker <hello@bookmarker.local>',
  ),
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  ping: async (userId, id) =>
    void (await pub.publish('bookmarker:notify', JSON.stringify({ userId, id }))),
};

const QUEUE = 'bookmarker-jobs';
const queue = new Queue(QUEUE, { connection });
await queue.upsertJobScheduler('deliver', { every: 60_000 }, { name: 'deliver' });
await queue.upsertJobScheduler('reminders', { every: 15 * 60_000 }, { name: 'reminders' });
await queue.upsertJobScheduler('weekly', { every: 15 * 60_000 }, { name: 'weekly' });

const worker = new Worker(
  QUEUE,
  async (job) => {
    const now = new Date();
    switch (job.name) {
      case 'deliver': {
        const r = await deliverDue(ctx, now);
        const emails = await emailDelivered(ctx, now);
        return { ...r, emails };
      }
      case 'reminders':
        return { sent: await runReminders(ctx, now) };
      case 'weekly':
        return { sent: await runWeekly(ctx, now) };
      default:
        logger.warn({ name: job.name }, 'unknown job');
    }
  },
  { connection, concurrency: 1 },
);

worker.on('completed', (job, result) => logger.info({ job: job.name, result }, 'job done'));
worker.on('failed', (job, err) => logger.error({ job: job?.name, err }, 'job failed'));
logger.info('worker started');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    logger.info({ sig }, 'worker shutting down');
    await worker.close();
    await queue.close();
    await db.$disconnect();
    connection.disconnect();
    pub.disconnect();
    process.exit(0);
  });
}
