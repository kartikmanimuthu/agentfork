-- CreateTable
CREATE TABLE "claw_chat_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claw_chat_sessions_threadId_key" ON "claw_chat_sessions"("threadId");

-- CreateIndex
CREATE INDEX "claw_chat_sessions_tenantId_idx" ON "claw_chat_sessions"("tenantId");
