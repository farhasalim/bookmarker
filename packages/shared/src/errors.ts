/**
 * Every API error has this shape: { error: { code, message } } (SRS section 6).
 * Codes are stable strings the web app can switch on.
 */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  BAD_ORIGIN: 'BAD_ORIGIN',
  INTERNAL: 'INTERNAL',
  // Spoiler gate
  NOT_AT_BOOKMARK: 'NOT_AT_BOOKMARK',
  NOT_FINISHED: 'NOT_FINISHED',
  // Rooms / chapters
  CHAPTERS_LOCKED: 'CHAPTERS_LOCKED',
  CHAPTERS_NOT_CONFIRMED: 'CHAPTERS_NOT_CONFIRMED',
  PLAN_LIMIT: 'PLAN_LIMIT',
  // Clubs
  LAST_HOST: 'LAST_HOST',
  // Invites (AT-14: distinct errors)
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  INVITE_USED_UP: 'INVITE_USED_UP',
  INVITE_INVALID: 'INVITE_INVALID',
  // Auth
  MAGIC_LINK_INVALID: 'MAGIC_LINK_INVALID',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}
