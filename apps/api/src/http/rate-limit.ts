import type { Redis } from 'ioredis';
import type { RequestHandler } from 'express';
import { HttpError } from './errors.ts';

/** Fixed-window counters (SEC-6). Redis in production; memory in tests and dev without Redis. */
export interface RateLimiter {
  /** Returns true if this hit is allowed. */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export function redisRateLimiter(redis: Redis): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const k = `rl:${key}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSeconds);
      return n <= limit;
    },
  };
}

export function memoryRateLimiter(): RateLimiter & { reset(): void } {
  const hits = new Map<string, { n: number; until: number }>();
  return {
    async hit(key, limit, windowSeconds) {
      const now = Date.now();
      const cur = hits.get(key);
      if (!cur || cur.until <= now) {
        hits.set(key, { n: 1, until: now + windowSeconds * 1000 });
        return 1 <= limit;
      }
      cur.n += 1;
      return cur.n <= limit;
    },
    reset() {
      hits.clear();
    },
  };
}

/** The SRS limits, in one place. */
export const LIMITS = {
  auth: { limit: 10, window: 15 * 60 }, // per IP
  writes: { limit: 30, window: 60 }, // per user
  invites: { limit: 5, window: 60 * 60 }, // per club
  posts: { limit: 20, window: 60 * 60 }, // per reader
} as const;

export function limit(
  limiter: RateLimiter,
  name: keyof typeof LIMITS,
  keyOf: (req: Parameters<RequestHandler>[0]) => string,
  /** Override the SRS number (from config); the window stays the same. */
  maxOverride?: number,
): RequestHandler {
  const { window } = LIMITS[name];
  const max = maxOverride ?? LIMITS[name].limit;
  return async (req, _res, next) => {
    const ok = await limiter.hit(`${name}:${keyOf(req)}`, max, window);
    if (!ok)
      return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.'));
    next();
  };
}
