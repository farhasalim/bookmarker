import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, type Browser, type Page } from '@playwright/test';
import { E2E_DB, MAIL_DIR } from '../playwright.config';

/** Newest email to `to`, read from the file mailer. */
export async function lastEmailTo(to: string): Promise<{ subject: string; text: string }> {
  let found: { subject: string; text: string; to: string } | undefined;
  await expect
    .poll(() => {
      const files = readdirSync(MAIL_DIR).sort();
      found = files
        .map(
          (f) =>
            JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')) as {
              to: string;
              subject: string;
              text: string;
            },
        )
        .filter((m) => m.to === to)
        .at(-1);
      return !!found;
    })
    .toBe(true);
  return found!;
}

/** Sign in through the real magic-link flow; returns a page with a session. */
export async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/signin');
  await page.getByLabel(/sign-in link by email|link by email/i).fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  const mail = await lastEmailTo(email);
  const link = mail.text.match(/https?:\/\/\S+magic-link\/verify\?token=[\w-]+/)![0];
  await page.goto(link);
  await expect(page).toHaveURL(/\/home$/);
  return page;
}

/** Run worker jobs once, as if `in` minutes had passed (e.g. a post batch). */
export function runWorker(
  job: 'deliver' | 'reminders' | 'weekly' | 'all',
  opts: { in?: string } = {},
) {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@bookmarker/worker',
      'exec',
      'tsx',
      'src/run-once.ts',
      job,
      ...(opts.in ? [`--in=${opts.in}`] : []),
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: E2E_DB,
        SMTP_URL: `file://${MAIL_DIR}`,
        APP_URL: 'http://localhost:3000',
      },
      stdio: 'pipe',
    },
  );
}

/** Type into a field and wait until it sticks (guards against hydration/re-render races). */
export async function fillStable(page: Page, label: string, value: string) {
  await expect(async () => {
    await page.getByLabel(label).fill(value);
    await expect(page.getByLabel(label)).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}
