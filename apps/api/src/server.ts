import { createServer } from 'node:http';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { createDb } from '@bookmarker/db';
import { mailerFromUrl } from '@bookmarker/mail';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { googleAuth } from './auth/google.ts';
import { memoryRateLimiter, redisRateLimiter } from './http/rate-limit.ts';
import { memoryBus, redisBus } from './realtime/bus.ts';
import { attachRealtime, createIO } from './realtime/hub.ts';
import { memoryCache, openLibrary } from './services/books.ts';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: 'api' } });
const db = createDb(config.DATABASE_URL);

const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
const bus = redis ? await redisBus(redis, redis.duplicate()) : memoryBus();
const cache = redis
  ? {
      get: (k: string) => redis.get(k),
      set: async (k: string, v: string, ttl: number) => void (await redis.set(k, v, 'EX', ttl)),
    }
  : memoryCache();

const app = createApp({
  config,
  db,
  logger,
  mailer: mailerFromUrl(config.SMTP_URL, config.EMAIL_FROM),
  limiter: redis ? redisRateLimiter(redis) : memoryRateLimiter(),
  bus,
  books: openLibrary(cache),
  google:
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? googleAuth(
          config.GOOGLE_CLIENT_ID,
          config.GOOGLE_CLIENT_SECRET,
          `${config.API_URL}/api/v1/auth/google/callback`,
        )
      : null,
  now: () => new Date(),
});

const server = createServer(app);
const io = createIO(server, config.appOrigin);
const realtime = attachRealtime(io, db, bus, [config.appOrigin, config.apiOrigin], logger);

// The worker publishes { userId, id } when it delivers an in-app notification.
if (redis) {
  const sub = redis.duplicate();
  await sub.subscribe('bookmarker:notify');
  sub.on('message', (_ch, msg) => {
    try {
      const { userId, id } = JSON.parse(msg) as { userId: string; id: string };
      realtime.notifyUser(userId, id);
    } catch {
      /* ignore malformed */
    }
  });
}

server.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'));

// Zero-downtime-friendly shutdown: stop accepting, finish in-flight, then exit.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    logger.info({ sig }, 'shutting down');
    realtime.close();
    io.close();
    server.close(async () => {
      await db.$disconnect();
      redis?.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
