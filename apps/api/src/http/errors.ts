import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { GateError } from '@bookmarker/gate';
import type { ApiErrorBody, ErrorCode } from '@bookmarker/shared';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, 'NOT_FOUND', 'Not found');
export const forbidden = (msg = 'You cannot do that') => new HttpError(403, 'FORBIDDEN', msg);

/** Turns any thrown error into { error: { code, message } } (SRS section 6). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong' } };

  if (err instanceof HttpError || err instanceof GateError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION',
        message: 'Some fields are not valid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: { code: 'VALIDATION', message: 'Malformed JSON' } };
  } else {
    req.log?.error({ err }, 'unhandled error');
    body = { error: { code: 'INTERNAL', message: 'Something went wrong' } };
  }
  res.status(status).json(body);
};
