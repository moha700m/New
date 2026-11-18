-- AlterTable
ALTER TABLE "GithubConnection" ADD COLUMN     "appOwner" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "costUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ConnectEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "target" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectEvent_createdAt_idx" ON "ConnectEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");
