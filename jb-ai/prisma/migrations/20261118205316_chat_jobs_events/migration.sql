-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "stopRequested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatEvent" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatEvent_messageId_seq_idx" ON "ChatEvent"("messageId", "seq");

-- CreateIndex
CREATE INDEX "ChatEvent_createdAt_idx" ON "ChatEvent"("createdAt");
