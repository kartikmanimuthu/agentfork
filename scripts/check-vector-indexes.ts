import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const MIGRATIONS_DIR = 'prisma/migrations';

function expectedVectorIndexes(): string[] {
  const names = new Set<string>();
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(MIGRATIONS_DIR, entry.name, 'migration.sql');
    if (!existsSync(file)) continue;
    for (const statement of readFileSync(file, 'utf8').split(';')) {
      if (!/USING\s+(hnsw|ivfflat)/i.test(statement)) continue;
      const match = statement.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/i);
      if (match) names.add(match[1]);
    }
  }
  return [...names].sort();
}

const expected = expectedVectorIndexes();
if (expected.length === 0) {
  console.log('check-vector-indexes: ok — no vector indexes defined in migrations');
  process.exit(0);
}

const prisma = new PrismaClient();
let present: string[];
try {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `;
  present = rows.map((r) => r.indexname);
} catch (error) {
  console.log(`check-vector-indexes: skipped — database not reachable (${(error as Error).message.split('\n')[0]})`);
  process.exit(0);
} finally {
  await prisma.$disconnect();
}

const missing = expected.filter((name) => !present.includes(name));

if (missing.length > 0) {
  console.error(`check-vector-indexes: FAIL — ${missing.length} of ${expected.length} vector index(es) missing from your database:`);
  for (const name of missing) console.error(`  - ${name}`);
  console.error('  Prisma cannot model HNSW indexes on Unsupported("vector(...)") columns, so `db push` never creates them');
  console.error('  and `migrate dev` tries to drop them. Semantic search silently falls back to sequential scans.');
  console.error('  Fix: bunx prisma migrate deploy --schema=./prisma/schema.prisma');
  process.exit(1);
}

console.log(`check-vector-indexes: ok — all ${expected.length} vector index(es) present`);
