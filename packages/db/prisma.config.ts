import { config } from 'dotenv';

// The repo-root .env is the one source of settings; a local .env here can override it.
config({
  path: [
    new URL('.env', import.meta.url).pathname,
    new URL('../../.env', import.meta.url).pathname,
  ],
  quiet: true,
});
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
