-- CreateTable
CREATE TABLE "sdk_widgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sdkId" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#1a1a2e',
    "secondaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "position" TEXT NOT NULL DEFAULT 'right',
    "headerText" TEXT NOT NULL DEFAULT 'Hey there!',
    "headerIcon" TEXT,
    "botName" TEXT NOT NULL DEFAULT 'AI Assistant',
    "botAvatar" TEXT,
    "welcomeMessage" TEXT NOT NULL DEFAULT 'How can I help you today?',
    "inputPlaceholder" TEXT NOT NULL DEFAULT 'Write a message...',
    "customCss" TEXT,
    "preChatForm" JSONB,
    "quickReplies" JSONB,
    "proactiveRules" JSONB,
    "kbEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fileUpload" BOOLEAN NOT NULL DEFAULT false,
    "csatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "csatType" TEXT NOT NULL DEFAULT 'thumbs',
    "allowedOrigins" TEXT[],
    "rateLimitRpm" INTEGER NOT NULL DEFAULT 60,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sdk_sessions" (
    "id" TEXT NOT NULL,
    "sdkWidgetId" TEXT NOT NULL,
    "inferenceSessionId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "visitorName" TEXT,
    "visitorEmail" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_feedbacks" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csat_responses" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sdkWidgetId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csat_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sdk_widgets_apiKeyId_key" ON "sdk_widgets"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "sdk_widgets_sdkId_key" ON "sdk_widgets"("sdkId");

-- CreateIndex
CREATE INDEX "sdk_widgets_tenantId_idx" ON "sdk_widgets"("tenantId");

-- CreateIndex
CREATE INDEX "sdk_widgets_sdkId_idx" ON "sdk_widgets"("sdkId");

-- CreateIndex
CREATE INDEX "sdk_widgets_agentId_idx" ON "sdk_widgets"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "sdk_sessions_inferenceSessionId_key" ON "sdk_sessions"("inferenceSessionId");

-- CreateIndex
CREATE INDEX "sdk_sessions_sdkWidgetId_idx" ON "sdk_sessions"("sdkWidgetId");

-- CreateIndex
CREATE INDEX "sdk_sessions_visitorId_idx" ON "sdk_sessions"("visitorId");

-- CreateIndex
CREATE INDEX "sdk_sessions_inferenceSessionId_idx" ON "sdk_sessions"("inferenceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "message_feedbacks_messageId_key" ON "message_feedbacks"("messageId");

-- CreateIndex
CREATE INDEX "message_feedbacks_sessionId_idx" ON "message_feedbacks"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "message_feedbacks_messageId_sessionId_key" ON "message_feedbacks"("messageId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "csat_responses_sessionId_key" ON "csat_responses"("sessionId");

-- CreateIndex
CREATE INDEX "csat_responses_sdkWidgetId_idx" ON "csat_responses"("sdkWidgetId");

-- AddForeignKey
ALTER TABLE "api_key_executions" ADD CONSTRAINT "api_key_executions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_executions" ADD CONSTRAINT "api_key_executions_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_widgets" ADD CONSTRAINT "sdk_widgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_widgets" ADD CONSTRAINT "sdk_widgets_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_widgets" ADD CONSTRAINT "sdk_widgets_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_sessions" ADD CONSTRAINT "sdk_sessions_sdkWidgetId_fkey" FOREIGN KEY ("sdkWidgetId") REFERENCES "sdk_widgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdk_sessions" ADD CONSTRAINT "sdk_sessions_inferenceSessionId_fkey" FOREIGN KEY ("inferenceSessionId") REFERENCES "inference_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_feedbacks" ADD CONSTRAINT "message_feedbacks_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "inference_session_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_feedbacks" ADD CONSTRAINT "message_feedbacks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_responses" ADD CONSTRAINT "csat_responses_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "inference_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_responses" ADD CONSTRAINT "csat_responses_sdkWidgetId_fkey" FOREIGN KEY ("sdkWidgetId") REFERENCES "sdk_widgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
