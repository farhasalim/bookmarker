import type { PrismaClient } from './generated/client.ts';

/** Empties every application table. Tests only — refuses to run against a non-test database. */
export async function resetDb(db: PrismaClient): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_test\b|test/.test(url)) {
    throw new Error(`resetDb refused: DATABASE_URL does not look like a test database (${url})`);
  }
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
