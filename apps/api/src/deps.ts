import type { Db } from '@bookmarker/db';
import type { Mailer } from '@bookmarker/mail';
import type { Logger } from 'pino';
import type { Config } from './config.ts';
import type { RateLimiter } from './http/rate-limit.ts';
import type { EventBus } from './realtime/bus.ts';
import type { BookSearch } from './services/books.ts';
import type { GoogleAuth } from './auth/google.ts';

/** Everything a route needs, passed in so tests can swap any piece. */
export interface Deps {
  config: Config;
  db: Db;
  mailer: Mailer;
  limiter: RateLimiter;
  bus: EventBus;
  books: BookSearch;
  google: GoogleAuth | null;
  logger: Logger;
  now: () => Date;
}
