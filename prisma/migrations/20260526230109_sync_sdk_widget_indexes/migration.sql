-- DropIndex
DROP INDEX "message_feedbacks_messageId_sessionId_key";

-- DropIndex
DROP INDEX "sdk_sessions_inferenceSessionId_idx";

-- DropIndex
DROP INDEX "sdk_widgets_apiKeyId_key";

-- DropIndex
DROP INDEX "sdk_widgets_sdkId_idx";

-- CreateIndex
CREATE INDEX "csat_responses_sdkWidgetId_createdAt_idx" ON "csat_responses"("sdkWidgetId", "createdAt");

-- CreateIndex
CREATE INDEX "sdk_sessions_sdkWidgetId_createdAt_idx" ON "sdk_sessions"("sdkWidgetId", "createdAt");

-- CreateIndex
CREATE INDEX "sdk_widgets_tenantId_status_idx" ON "sdk_widgets"("tenantId", "status");
