// Synchronously loads the repo-root .env before any test module evaluates.
//
// Without this, T3 Env modules (this lib's ./env.ts, @chatbot/shared's env.ts)
// eagerly validate process.env at import time, and whether that succeeds
// depends on a race: some heavier import graphs (e.g. anything transitively
// loading @prisma/client, which has its own internal dotenv side effect)
// happen to have process.env populated by the time they run; lighter test
// files (or ones that construct something like EncryptionService before any
// Prisma import) can lose that race and see required env vars as undefined.
// Loading synchronously here removes the race entirely.
//
// `dotenv` itself is only present as a nested transitive dependency (not
// resolvable as a bare specifier from this package), so this is a minimal
// dependency-free .env line parser rather than pulling in a new dependency
// for one line of behavior.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
