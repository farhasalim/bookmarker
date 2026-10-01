import { mkdirSync, rmSync } from 'node:fs';
import pg from 'pg';
import { E2E_DB, MAIL_DIR } from '../playwright.config';

/** Empty every table (except migrations) and the mailbox. Test databases only. */
export async function resetE2E() {
  rmSync(MAIL_DIR, { recursive: true, force: true });
  mkdirSync(MAIL_DIR, { recursive: true });
  if (!/test/.test(E2E_DB)) throw new Error('Refusing to wipe a non-test database');
  const client = new pg.Client({ connectionString: E2E_DB });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
    );
    if (rows.length)
      await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
  } finally {
    await client.end();
  }
}
