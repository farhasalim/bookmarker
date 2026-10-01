import type { ErrorCode } from '@bookmarker/shared';

/** Thrown by gate functions; the API turns it into { error: { code, message } }. */
export class GateError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409 | 400,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

/** A post the viewer may not see is reported as missing, never as forbidden (SEC-5). */
export const notFound = () => new GateError(404, 'NOT_FOUND', 'Not found');
