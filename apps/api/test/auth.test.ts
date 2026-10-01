import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { resetDb } from '@bookmarker/db/testing';
import { profileFromClaims } from '../src/auth/google.ts';
import { APP, agentFor, db, makeDeps } from './helpers.ts';

let t: ReturnType<typeof makeDeps>;
beforeEach(async () => {
  await resetDb(db);
  t = makeDeps();
});
afterAll(() => db.$disconnect());

function linkFrom(text: string): string {
  const m = text.match(/(http:\/\/localhost:4000\/api\/v1\/auth\/magic-link\/verify\?token=[\w-]+)/);
  if (!m) throw new Error('no link in email');
  return m[1]!.replace('http://localhost:4000', '');
}

describe('magic link sign-in (FR-1, SEC-3)', () => {
  it('emails a link that signs the user in once', async () => {
    const anon = agentFor(t.app);
    await anon.post('/auth/magic-link', { email: 'New.Reader@Example.test' }).expect(202);
    expect(t.mailer.sent).toHaveLength(1);
    const path = linkFrom(t.mailer.sent[0]!.text);

    const res = await request(t.app).get(path).expect(303);
    expect(res.headers.location).toBe(`${APP}/home`);
    const cookie = String(res.headers['set-cookie']).match(/bm_session=[^;]+/)![0];
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(String(res.headers['set-cookie'])).toMatch(/SameSite=Lax/i);

    const me = await agentFor(t.app, cookie).get('/me').expect(200);
    expect(me.body.email).toBe('new.reader@example.test');

    // Second use fails.
    const again = await request(t.app).get(path).expect(303);
    expect(again.headers.location).toBe(`${APP}/signin?error=link`);
  });

  it('expires after 15 minutes', async () => {
    await agentFor(t.app).post('/auth/magic-link', { email: 'late@example.test' }).expect(202);
    const path = linkFrom(t.mailer.sent[0]!.text);
    t.clock.advance(16 * 60 * 1000);
    const res = await request(t.app).get(path).expect(303);
    expect(res.headers.location).toContain('error=link');
  });

  it('stores only a hash of the token', async () => {
    await agentFor(t.app).post('/auth/magic-link', { email: 'h@example.test' }).expect(202);
    const token = linkFrom(t.mailer.sent[0]!.text).split('token=')[1]!;
    const rows = await db.magicToken.findMany();
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a bad email with a VALIDATION error', async () => {
    const res = await agentFor(t.app).post('/auth/magic-link', { email: 'nope' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rate-limits sign-in attempts per IP (SEC-6: 10 per 15 min)', async () => {
    for (let i = 0; i < 10; i++) {
      await agentFor(t.app).post('/auth/magic-link', { email: `r${i}@example.test` }).expect(202);
    }
    const res = await agentFor(t.app).post('/auth/magic-link', { email: 'r11@example.test' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('sessions and CSRF (SEC-1, SEC-8)', () => {
  it('answers 401 without a session', async () => {
    const res = await agentFor(t.app).get('/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses state-changing requests from another origin', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/magic-link')
      .set('Origin', 'https://evil.example')
      .send({ email: 'x@example.test' })
      .expect(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });

  it('logout ends the session', async () => {
    await agentFor(t.app).post('/auth/magic-link', { email: 'out@example.test' });
    const res = await request(t.app).get(linkFrom(t.mailer.sent[0]!.text));
    const cookie = String(res.headers['set-cookie']).match(/bm_session=[^;]+/)![0];
    const a = agentFor(t.app, cookie);
    await a.post('/auth/logout').expect(200);
    await a.get('/me').expect(401);
  });

  it('expires sessions after 30 days idle', async () => {
    const u = await db.user.create({ data: { email: 'idle@example.test', name: 'Idle' } });
    const { sessionCookie } = await import('./helpers.ts');
    const cookie = await sessionCookie(u.id);
    await db.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) } });
    await agentFor(t.app, cookie).get('/me').expect(401);
  });

  it('reports which providers are on', async () => {
    const res = await agentFor(t.app).get('/auth/providers').expect(200);
    expect(res.body).toEqual({ google: false, magicLink: true });
  });

  it('serves a health check', async () => {
    await request(t.app).get('/healthz').expect(200, { ok: true });
  });
});

describe('Google ID token claims (SEC-2)', () => {
  const good = { sub: '123', email: 'g@example.test', email_verified: true, nonce: 'n1', name: 'G' };
  it('accepts matching nonce and verified email', () => {
    expect(profileFromClaims(good, 'n1')).toMatchObject({ subject: '123', email: 'g@example.test' });
  });
  it('rejects a wrong nonce', () => {
    expect(() => profileFromClaims(good, 'other')).toThrow('nonce');
  });
  it('rejects an unverified email', () => {
    expect(() => profileFromClaims({ ...good, email_verified: false }, 'n1')).toThrow('verified');
  });
});
