-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "agentMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "agentSteps" JSONB;

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'auto',
    "authHeader" TEXT NOT NULL DEFAULT 'Authorization',
    "authScheme" TEXT NOT NULL DEFAULT 'Bearer',
    "tokenEncrypted" TEXT,
    "tokenLast4" TEXT,
    "extraHeaders" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "toolFilter" TEXT,
    "tools" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_slug_key" ON "McpServer"("slug");
