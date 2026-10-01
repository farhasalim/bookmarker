import { Router } from 'express';
import { MagicLinkRequest } from '@bookmarker/shared';
import { magicLinkEmail } from '@bookmarker/mail';
import type { Deps } from '../deps.ts';
import { HttpError } from '../http/errors.ts';
import { limit } from '../http/rate-limit.ts';
import { hashToken, newToken } from '../lib/tokens.ts';
import { SESSION_COOKIE, endSession, startSession } from '../auth/sessions.ts';
import { findOrCreateUser } from '../auth/users.ts';

const OAUTH_COOKIE = 'bm_oauth';
const MAGIC_TTL_MS = 15 * 60 * 1000;

export function authRoutes(d: Deps): Router {
  const r = Router();
  const byIp = limit(d.limiter, 'auth', (req) => req.ip ?? 'unknown', d.config.RATE_LIMIT_AUTH);
  const secure = d.config.COOKIE_SECURE;

  /* ---------------- magic link (FR-1: valid 15 minutes, single use) ---------------- */

  r.post('/magic-link', byIp, async (req, res) => {
    const { email } = MagicLinkRequest.parse(req.body);
    const token = newToken();
    await d.db.magicToken.create({
      data: {
        tokenHash: hashToken(token),
        email: email.toLowerCase(),
        expiresAt: new Date(d.now().getTime() + MAGIC_TTL_MS),
      },
    });
    const url = `${d.config.API_URL}/api/v1/auth/magic-link/verify?token=${token}`;
    await d.mailer.send(magicLinkEmail(email, url, { appUrl: d.config.APP_URL }));
    // Same answer whether or not the account exists (no account enumeration).
    res.status(202).json({ ok: true });
  });

  r.get('/magic-link/verify', byIp, async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const now = d.now();
    // Atomically claim the token so it can only ever be used once.
    const claimed = await d.db.magicToken.updateMany({
      where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      return res.redirect(303, `${d.config.APP_URL}/signin?error=link`);
    }
    const row = await d.db.magicToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    const user = await findOrCreateUser(d.db, {
      email: row.email,
      provider: 'email',
      subject: row.email,
    });
    if (user.deleted) return res.redirect(303, `${d.config.APP_URL}/signin?error=deleted`);
    await startSession(d.db, res, user.id, secure, req.cookies?.[SESSION_COOKIE]);
    res.redirect(303, `${d.config.APP_URL}/home`);
  });

  /* ---------------- Google (SEC-2) ---------------- */

  r.get('/google', byIp, (_req, res) => {
    if (!d.google) throw new HttpError(404, 'NOT_FOUND', 'Google sign-in is not configured');
    const { url, state, codeVerifier, nonce } = d.google.start();
    res.cookie(OAUTH_COOKIE, JSON.stringify({ state, codeVerifier, nonce }), {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      signed: true,
      maxAge: 10 * 60 * 1000,
      path: '/api/v1/auth',
    });
    res.redirect(302, url.toString());
  });

  r.get('/google/callback', byIp, async (req, res) => {
    if (!d.google) throw new HttpError(404, 'NOT_FOUND', 'Google sign-in is not configured');
    const raw = req.signedCookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/api/v1/auth' });
    const fail = () => res.redirect(303, `${d.config.APP_URL}/signin?error=google`);
    if (typeof raw !== 'string') return fail();
    let saved: { state: string; codeVerifier: string; nonce: string };
    try {
      saved = JSON.parse(raw);
    } catch {
      return fail();
    }
    if (req.query.state !== saved.state || typeof req.query.code !== 'string') return fail();
    try {
      const profile = await d.google.finish(req.query.code, saved.codeVerifier, saved.nonce);
      const user = await findOrCreateUser(d.db, {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        provider: 'google',
        subject: profile.subject,
      });
      if (user.deleted) return res.redirect(303, `${d.config.APP_URL}/signin?error=deleted`);
      await startSession(d.db, res, user.id, secure, req.cookies?.[SESSION_COOKIE]);
      res.redirect(303, `${d.config.APP_URL}/home`);
    } catch (err) {
      req.log?.warn({ err }, 'google sign-in failed');
      return fail();
    }
  });

  r.post('/logout', async (req, res) => {
    await endSession(d.db, res, req.cookies?.[SESSION_COOKIE], secure);
    res.json({ ok: true });
  });

  r.get('/providers', (_req, res) => {
    res.json({ google: d.google !== null, magicLink: true });
  });

  return r;
}
