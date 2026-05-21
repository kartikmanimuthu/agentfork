-- Task 7: SessionAnalytics — re-purposed ConversationAnalytics keyed by InferenceSession.id

CREATE TABLE "session_analytics" (
  "id"              TEXT             NOT NULL,
  "sessionId"       TEXT             NOT NULL,
  "tenantId"        TEXT             NOT NULL,
  "sentiment"       TEXT,
  "sentimentScores" JSONB,
  "isResolved"      BOOLEAN,
  "confidenceScore" DOUBLE PRECISION,
  "emotionalTone"   JSONB,
  "summary"         TEXT,
  "firstUserQuery"  TEXT,
  "language"        TEXT,
  "messageCount"    INTEGER,
  "analyzedAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "session_analytics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_analytics_sessionId_key" ON "session_analytics"("sessionId");
CREATE INDEX "session_analytics_tenantId_idx" ON "session_analytics"("tenantId");
CREATE INDEX "session_analytics_tenantId_sentiment_idx" ON "session_analytics"("tenantId", "sentiment");
CREATE INDEX "session_analytics_tenantId_isResolved_idx" ON "session_analytics"("tenantId", "isResolved");
CREATE INDEX "session_analytics_tenantId_analyzedAt_idx" ON "session_analytics"("tenantId", "analyzedAt");

ALTER TABLE "session_analytics"
  ADD CONSTRAINT "session_analytics_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
