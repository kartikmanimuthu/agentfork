-- CreateTable
CREATE TABLE "claw_playground_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "configOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claw_playground_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claw_playground_sessions_threadId_key" ON "claw_playground_sessions"("threadId");

-- CreateIndex
CREATE INDEX "claw_playground_sessions_tenantId_idx" ON "claw_playground_sessions"("tenantId");
