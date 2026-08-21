import { execSync } from 'node:child_process';

const BASE = process.env.MIGRATION_CHECK_BASE ?? 'origin/main';

function git(args: string): string {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

try {
  git(`rev-parse --verify --quiet ${BASE}^{commit}`);
} catch {
  console.log(`check-migrations: skipped — ${BASE} not available locally (git fetch origin main)`);
  process.exit(0);
}

const mergeBase = git(`merge-base ${BASE} HEAD`);
const schemaChanged = git(`diff --name-only ${mergeBase} -- prisma/schema.prisma`) !== '';

if (!schemaChanged) {
  console.log(`check-migrations: ok — prisma/schema.prisma unchanged vs ${BASE}`);
  process.exit(0);
}

const committed = git(`diff --name-only --diff-filter=A ${mergeBase} -- prisma/migrations`);
const untracked = git('ls-files --others --exclude-standard -- prisma/migrations');

if (committed === '' && untracked === '') {
  console.error(`check-migrations: FAIL — prisma/schema.prisma changed vs ${BASE} but no migration was added.`);
  console.error('  Production runs `prisma migrate deploy`, so a db push-only branch never creates these tables there.');
  console.error('  Fix: bunx prisma migrate dev --name <describe_change> --create-only');
  process.exit(1);
}

console.log('check-migrations: ok — schema change is accompanied by a migration');
