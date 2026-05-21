-- Task 2: Create normalized inference_session_messages table, backfill, drop JSON column

-- 1. Create the normalized messages table
CREATE TABLE "inference_session_messages" (
  "id"         TEXT                NOT NULL,
  "sessionId"  TEXT                NOT NULL,
  "role"       TEXT                NOT NULL,
  "content"    TEXT                NOT NULL,
  "tokenCount" INTEGER,
  "embedding"  vector(1024),
  "createdAt"  TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inference_session_messages_pkey" PRIMARY KEY ("id")
);

-- 2. Indexes
CREATE INDEX "inference_session_messages_sessionId_idx"
  ON "inference_session_messages"("sessionId");
CREATE INDEX "inference_session_messages_sessionId_createdAt_idx"
  ON "inference_session_messages"("sessionId", "createdAt");

-- 3. Foreign key
ALTER TABLE "inference_session_messages"
  ADD CONSTRAINT "inference_session_messages_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Backfill from JSON messages array on existing inference_sessions rows.
--    Each element of the JSON array becomes one row, ordered by array position.
--    Generated IDs use gen_random_uuid()::text — unique strings, compatible with Prisma's TEXT id.
--    createdAt = session.createdAt + (idx * 1 ms) so ordering matches the original array.
INSERT INTO "inference_session_messages" ("id", "sessionId", "role", "content", "createdAt")
SELECT
  REPLACE(gen_random_uuid()::text, '-', ''),
  s."id",
  COALESCE(msg->>'role', 'user'),
  COALESCE(msg->>'content', ''),
  s."createdAt" + (ord * INTERVAL '1 millisecond')
FROM "inference_sessions" s,
     LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(s."messages") = 'array' THEN s."messages"
         ELSE '[]'::jsonb
       END
     ) WITH ORDINALITY AS t(msg, ord)
WHERE s."messages" IS NOT NULL;

-- 5. Drop the JSON column now that all rows are normalized
ALTER TABLE "inference_sessions" DROP COLUMN "messages";
