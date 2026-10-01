import { pino } from 'pino';
import request from 'supertest';
import { createDb } from '@bookmarker/db';
import { seed, type SeedResult } from '@bookmarker/db/seed';
import { resetDb } from '@bookmarker/db/testing';
import { MemoryMailer } from '@bookmarker/mail';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { Deps } from '../src/deps.ts';
import { memoryRateLimiter } from '../src/http/rate-limit.ts';
import { hashToken, newToken } from '../src/lib/tokens.ts';
import { memoryBus } from '../src/realtime/bus.ts';
import type { BookSearch } from '../src/services/books.ts';

export const APP = 'http://localhost:3000';
export const db = createDb();

export const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_URL: APP,
  API_URL: 'http://localhost:4000',
  SESSION_SECRET: 'test-secret-test-secret-test-secret',
});

export class Clock {
  t = new Date('2026-10-01T06:00:00Z'); // 11:30 IST, a Thursday
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export const fakeBooks: BookSearch = {
  async search(q) {
    return [
      {
        title: `Result for ${q}`,
        author: 'A. Author',
        isbn: '9780000000000',
        coverUrl: null,
        chapterTitles: ['One', 'Two'],
      },
    ];
  },
};

export function makeDeps(over: Partial<Deps> = {}) {
  const mailer = new MemoryMailer();
  const clock = new Clock();
  const limiter = memoryRateLimiter();
  const deps: Deps = {
    config,
    db,
    mailer,
    limiter,
    bus: memoryBus(),
    books: fakeBooks,
    google: null,
    logger: pino({ level: 'silent' }),
    now: clock.now,
    ...over,
  };
  return { deps, mailer, clock, limiter, app: createApp(deps) };
}

/** A signed-in cookie for `userId`, made the same way the real sign-in does. */
export async function sessionCookie(userId: string): Promise<string> {
  const token = newToken();
  await db.session.create({ data: { id: hashToken(token), userId } });
  return `bm_session=${token}`;
}

export type Agent = ReturnType<typeof agentFor>;

/** supertest with a session cookie and our Origin header on every request. */
export function agentFor(app: Parameters<typeof request>[0], cookie?: string) {
  const wrap = (r: request.Test) => {
    r.set('Origin', APP);
    if (cookie) r.set('Cookie', cookie);
    return r;
  };
  const a = request(app);
  return {
    get: (p: string) => wrap(a.get(`/api/v1${p}`)),
    post: (p: string, body?: object) => wrap(a.post(`/api/v1${p}`)).send(body ?? {}),
    put: (p: string, body?: object) => wrap(a.put(`/api/v1${p}`)).send(body ?? {}),
    patch: (p: string, body?: object) => wrap(a.patch(`/api/v1${p}`)).send(body ?? {}),
    delete: (p: string) => wrap(a.delete(`/api/v1${p}`)),
  };
}

export async function freshSeed(): Promise<SeedResult> {
  await resetDb(db);
  return seed(db);
}

export async function agents(app: Parameters<typeof request>[0], s: SeedResult) {
  return {
    meera: agentFor(app, await sessionCookie(s.users.meera)),
    rahul: agentFor(app, await sessionCookie(s.users.rahul)),
    anu: agentFor(app, await sessionCookie(s.users.anu)),
    outsider: agentFor(app, await sessionCookie(s.users.outsider)),
    anon: agentFor(app),
  };
}
