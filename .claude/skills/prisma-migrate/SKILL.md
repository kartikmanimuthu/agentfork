---
name: prisma-migrate
description: Run the full Prisma migration workflow — validate schema, generate client, push to DB, and run affected tests
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

4. **Push to development database**
   ```bash
   bunx prisma db push --schema=./prisma/schema.prisma
   ```

5. **Run affected tests**
   ```bash
   nx affected -t test
   ```

## Migration Creation (if needed)
If the user explicitly asks to create a migration (not just push):

```bash
bunx prisma migrate dev --schema=./prisma/schema.prisma --name <descriptive_name>
```

## Common Issues
- **Client not found**: Make sure step 3 (generate) ran successfully
- **Connection refused**: Check `docker compose ps` and ensure PostgreSQL is healthy on port 5432
- **Migration drift**: If db push reports drift, consider `prisma migrate dev` or `prisma db pull` to introspect
