-- Task 4: Link ApiKeyExecution rows to their session (nullable for stateless calls)

ALTER TABLE "api_key_executions"
  ADD COLUMN "sessionId" TEXT;

ALTER TABLE "api_key_executions"
  ADD CONSTRAINT "api_key_executions_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "api_key_executions_sessionId_idx" ON "api_key_executions"("sessionId");
