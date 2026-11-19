-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'pro');

-- CreateEnum
CREATE TYPE "UsageType" AS ENUM ('ai_reformulation', 'ai_reply', 'message_sent', 'email_to_placeholder', 'sms_otp');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "plan" "PlanTier" NOT NULL DEFAULT 'free',
ADD COLUMN     "planExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "UsageType" NOT NULL,
    "humhlinkerId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_records_userId_type_createdAt_idx" ON "usage_records"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "usage_records_type_createdAt_idx" ON "usage_records"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

