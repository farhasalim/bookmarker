import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_URL: z.url().default('http://localhost:3000'),
  API_URL: z.url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SESSION_SECRET: z.string().min(16),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  EMAIL_FROM: z.string().default('BookMarker <hello@bookmarker.local>'),
  LOG_LEVEL: z.string().default('info'),
  /** Sign-in requests per IP per 15 minutes (SEC-6 says 10). Raised only for e2e tests. */
  RATE_LIMIT_AUTH: z.coerce.number().int().min(1).default(10),
  /**
   * Express "trust proxy": how to find the visitor's IP behind proxies (used by
   * rate limits). 1 = one proxy (Caddy on our own server). See docs/render.md.
   */
  TRUST_PROXY: z
    .string()
    .default('1')
    .transform((v): boolean | number | string =>
      v === 'true' ? true : /^\d+$/.test(v) ? Number(v) : v,
    ),
});

export type Config = z.infer<typeof Env> & { appOrigin: string; apiOrigin: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  return {
    ...parsed,
    appOrigin: new URL(parsed.APP_URL).origin,
    apiOrigin: new URL(parsed.API_URL).origin,
  };
}
