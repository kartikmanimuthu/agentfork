---
name: prisma-migrate
description: Run the full Prisma migration workflow — validate schema, generate client, author and review a migration, apply it, and run affected tests
disable-model-invocation: true
---

Run the complete Prisma migration workflow for this project.

## Prerequisites
- Docker must be running with PostgreSQL 16 + pgvector (`docker compose up -d`)
- `DATABASE_URL` must be set in `.env`

## Workflow

1. **Validate schema**
   ```bash
   bunx prisma validate --schema=./prisma/schema.prisma
   ```

2. **Format schema**
   ```bash
   bunx prisma format --schema=./prisma/schema.prisma
   ```

3. **Generate Prisma Client**
   ```bash
   bunx prisma generate --schema=./prisma/schema.prisma
   ```

4. **Author the migration** (skip only if `schema.prisma` is unchanged)
   ```bash
   bunx prisma migrate dev --schema=./prisma/schema.prisma --name <descriptive_name> --create-only
   ```

5. **Review the generated SQL — mandatory**

   Open the new file in `prisma/migrations/`. Prisma emits these at the top of
   every migration:

   ```sql
   DROP INDEX "claw_memories_embedding_hnsw";
   DROP INDEX "idx_document_chunks_embedding";
   ```

   **Delete them.** Prisma cannot model HNSW indexes on `Unsupported("vector(...)")`
   columns, so it sees them in the database, not in the schema, and treats them as
   drift. Shipping the drops silently degrades memory recall and knowledge-base
   search to sequential scans — no error, just wrong. Also check for any other
   unintended `DROP` or destructive `ALTER` before continuing.

6. **Apply it**
   ```bash
   bunx prisma migrate deploy --schema=./prisma/schema.prisma
   ```

7. **Verify and run affected tests**
   ```bash
   bun run check:db
   nx affected -t test
   ```

## When `db push` is appropriate

Only against a database you are willing to destroy — quick iteration while the
schema shape is still moving. It skips the pgvector indexes entirely, so never use
it to build a working local database and never let a branch reach review with a
schema change that has no migration. Production runs `migrate deploy`; a push-only
branch never creates its tables there. `bun run check:migrations` enforces this.

## Common Issues
- **Client not found**: Make sure step 3 (generate) ran successfully
- **Connection refused**: Check `docker compose ps` and ensure PostgreSQL is healthy on port 5432
- **Vector indexes missing**: `bun run check:indexes` failing means the database was built with `db push`, or a migration's `DROP INDEX` lines were not removed. Rebuild with `migrate deploy`.
