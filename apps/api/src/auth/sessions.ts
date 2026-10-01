import type { Db } from '@bookmarker/db';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { HttpError } from '../http/errors.ts';
import { hashToken, newToken } from '../lib/tokens.ts';

export const SESSION_COOKIE = 'bm_session';
const IDLE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
/** Avoid a write on every request: refresh last_seen_at at most hourly. */
const TOUCH_EVERY = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

export function cookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: IDLE_DAYS * DAY };
}

/**
 * SEC-1: opaque id in an HttpOnly cookie, stored server-side (as a hash),
 * a fresh session on every sign-in, expiring after 30 days idle.
 */
export async function startSession(
  db: Db,
  res: Response,
  userId: string,
  secure: boolean,
  oldToken?: string,
) {
  if (oldToken) await db.session.deleteMany({ where: { id: hashToken(oldToken) } });
  const token = newToken();
  await db.session.create({ data: { id: hashToken(token), userId } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(secure));
}

export async function endSession(
  db: Db,
  res: Response,
  token: string | undefined,
  secure: boolean,
) {
  if (token) await db.session.deleteMany({ where: { id: hashToken(token) } });
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(secure), maxAge: undefined });
}

/** Resolves a raw cookie token to a user, or null. Shared by HTTP and Socket.IO. */
export async function userFromToken(
  db: Db,
  token: string | undefined,
  now = new Date(),
): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token) return null;
  const id = hashToken(token);
  const session = await db.session.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, name: true, isAdmin: true, deletedAt: true } },
    },
  });
  if (!session || session.user.deletedAt) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > IDLE_DAYS * DAY) {
    await db.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY) {
    await db.session.update({ where: { id }, data: { lastSeenAt: now } }).catch(() => undefined);
  }
  const { deletedAt: _d, ...user } = session.user;
  return { user, sessionId: id };
}

export function loadSession(db: Db): RequestHandler {
  return async (req, _res, next) => {
    const found = await userFromToken(db, req.cookies?.[SESSION_COOKIE]);
    if (found) {
      req.user = found.user;
      req.sessionId = found.sessionId;
    }
    next();
  };
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
  next();
};

/** Narrowing helper for handlers behind requireUser. */
export function me(req: { user?: SessionUser }): SessionUser {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  return req.user;
}
