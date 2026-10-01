import { config } from 'dotenv';

// The repo-root .env is the one source of settings; a local .env here can override it.
config({
  path: [
    new URL('.env', import.meta.url).pathname,
    new URL('../../.env', import.meta.url).pathname,
  ],
  quiet: true,
});
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` (run at install, including inside Docker builds) needs no
  // database, so DATABASE_URL is optional here; migrate commands still need it.
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
