import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * End-to-end tests run the real stack: the API (port 4000) and the built web app
 * (port 3000) against a throwaway Postgres database. Emails are written to files
 * (SMTP_URL=file://…) so tests can follow magic links. Build first with
 * `pnpm --filter @bookmarker/web e2e:build`.
 */
const here = dirname(fileURLToPath(import.meta.url));
export const MAIL_DIR = resolve(here, 'test-results/mail');
export const E2E_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://bookmarker:bookmarker@localhost:5432/bookmarker_e2e_test';

const apiEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3000',
  DATABASE_URL: E2E_DB,
  REDIS_URL: '',
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
  SMTP_URL: `file://${MAIL_DIR}`,
  LOG_LEVEL: 'warn',
  // Every test signs several people in from 127.0.0.1; the real limit is 10 per 15 min.
  RATE_LIMIT_AUTH: '1000',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'pnpm --filter @bookmarker/api start',
      url: 'http://localhost:4000/healthz',
      env: apiEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm exec next start -p 3000',
      url: 'http://localhost:3000',
      env: { API_INTERNAL_URL: 'http://localhost:4000', PORT: '3000' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
