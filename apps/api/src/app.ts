import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import type { Deps } from './deps.ts';
import { loadSession, requireUser } from './auth/sessions.ts';
import { errorHandler, notFound } from './http/errors.ts';
import { originCheck } from './http/origin.ts';
import { authRoutes } from './routes/auth.ts';
import { clubRoutes } from './routes/clubs.ts';
import { meRoutes } from './routes/me.ts';
import { moderationRoutes } from './routes/moderation.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { postRoutes } from './routes/posts.ts';
import { roomRoutes } from './routes/rooms.ts';

export function createApp(d: Deps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Caddy

  app.use(
    pinoHttp({
      logger: d.logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
    }),
  );
  // SEC-9. The API serves JSON only, so the strictest CSP applies here;
  // the web app sets its own CSP for pages.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: d.config.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser(d.config.SESSION_SECRET));

  /** NFR-4 health check: also proves the database answers. */
  app.get('/healthz', async (_req, res) => {
    try {
      await d.db.room.count({ take: 1 });
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const v1 = Router();
  v1.use(originCheck([d.config.appOrigin, d.config.apiOrigin]));
  v1.use(loadSession(d.db));
  v1.use('/auth', authRoutes(d));

  // Public (signed out): the invite preview for the join page. Everything after
  // requireUser needs a session.
  const clubs = clubRoutes(d);
  v1.use((req, res, next) => {
    if (req.method === 'GET' && /^\/invites\/[^/]+$/.test(req.path)) return clubs(req, res, next);
    next();
  });
  v1.use(requireUser);
  v1.use(meRoutes(d));
  v1.use(clubs);
  v1.use(roomRoutes(d));
  v1.use(postRoutes(d));
  v1.use(notificationRoutes(d));
  v1.use(moderationRoutes(d));
  v1.use(() => {
    throw notFound();
  });

  app.use('/api/v1', v1);
  app.use(errorHandler);
  return app;
}
