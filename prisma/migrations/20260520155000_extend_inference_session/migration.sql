-- Task 1: Extend InferenceSession with channel, channelMetadata, agentVersionId, status, endedAt, endReason
-- Rename: expiresAt -> idleExpiresAt, metadata -> channelMetadata
-- Backfill: status='active', channel='API' for existing rows (defaults handle it)

-- Rename existing columns (preserves data)
ALTER TABLE "inference_sessions" RENAME COLUMN "expiresAt" TO "idleExpiresAt";
ALTER TABLE "inference_sessions" RENAME COLUMN "metadata" TO "channelMetadata";

-- Add new columns with defaults so existing rows are valid
ALTER TABLE "inference_sessions"
  ADD COLUMN "agentVersionId" TEXT,
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'API',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "endReason" TEXT;

-- FK to agent_versions (nullable)
ALTER TABLE "inference_sessions"
  ADD CONSTRAINT "inference_sessions_agentVersionId_fkey"
  FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop old index, create new one on the renamed column
DROP INDEX IF EXISTS "inference_sessions_expiresAt_idx";
CREATE INDEX "inference_sessions_idleExpiresAt_idx" ON "inference_sessions"("idleExpiresAt");

-- New indexes for the Sessions list query patterns
CREATE INDEX "inference_sessions_tenantId_status_idx" ON "inference_sessions"("tenantId", "status");
CREATE INDEX "inference_sessions_tenantId_channel_status_idx" ON "inference_sessions"("tenantId", "channel", "status");
