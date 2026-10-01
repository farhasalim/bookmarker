import type { RequestHandler } from 'express';
import { HttpError } from './errors.ts';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence (SEC-8): SameSite=Lax cookies plus this check. A state-changing
 * request must come from our own web origin. The magic-link verify and OAuth
 * callback are GETs, so they are unaffected.
 */
export function originCheck(allowed: string[]): RequestHandler {
  const ok = new Set(allowed);
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin') ?? refererOrigin(req.get('referer'));
    if (!origin || !ok.has(origin)) {
      return next(new HttpError(403, 'BAD_ORIGIN', 'Request origin not allowed'));
    }
    next();
  };
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
