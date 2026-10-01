import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, URL-safe (SEC-3). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
