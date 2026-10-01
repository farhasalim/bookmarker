import 'dotenv/config';
import { createDb } from './index.ts';
import { seed } from './seed.ts';

const db = createDb();
const existing = await db.club.count();
if (existing > 0) {
  console.log('Database already has data; skipping seed.');
} else {
  const r = await seed(db);
  console.log(`Seeded "Thursday Readers" (room ${r.roomId}) with ${r.posts.length} posts.`);
}
await db.$disconnect();
