-- CreateEnum
CREATE TYPE "HumlinkerStatus" AS ENUM ('pending', 'active', 'archived', 'blocked');

-- CreateEnum
CREATE TYPE "HumlinkerChannel" AS ENUM ('app', 'sms', 'whatsapp', 'email');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'ai', 'system');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('text', 'draft_snapshot', 'system');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fcmToken" TEXT,
ADD COLUMN     "twilioConversationSid" TEXT;

-- CreateTable
CREATE TABLE "humlinkers" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "mirrorId" TEXT,
    "status" "HumlinkerStatus" NOT NULL DEFAULT 'pending',
    "blockedBy" TEXT,
    "communicationChannel" "HumlinkerChannel" NOT NULL DEFAULT 'app',
    "targetContactName" TEXT NOT NULL,
    "targetContactEmail" TEXT,
    "targetContactPhone" TEXT,
    "relationshipType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "creatorLanguage" TEXT NOT NULL,
    "targetLanguage" TEXT,
    "twilioConversationSid" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "humlinkers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "humhlinkerId" TEXT NOT NULL,
    "objectiveMessage" TEXT NOT NULL,
    "realMessage" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "humhlinkerId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "type" "ChatMessageType" NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "draftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumbers" TEXT[],
    "emails" TEXT[],
    "matchedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "humlinkers_mirrorId_key" ON "humlinkers"("mirrorId");

-- CreateIndex
CREATE INDEX "humlinkers_senderId_lastActivityAt_idx" ON "humlinkers"("senderId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "humlinkers_targetId_lastActivityAt_idx" ON "humlinkers"("targetId", "lastActivityAt" DESC);

-- CreateIndex
CREATE INDEX "humlinkers_status_idx" ON "humlinkers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "humlinkers_senderId_targetId_key" ON "humlinkers"("senderId", "targetId");

-- CreateIndex
CREATE INDEX "drafts_humhlinkerId_version_idx" ON "drafts"("humhlinkerId", "version" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_humhlinkerId_createdAt_idx" ON "chat_messages"("humhlinkerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "contacts_ownerId_idx" ON "contacts"("ownerId");

-- CreateIndex
CREATE INDEX "contacts_matchedUserId_idx" ON "contacts"("matchedUserId");

-- CreateIndex
CREATE INDEX "contacts_phoneNumbers_idx" ON "contacts" USING GIN ("phoneNumbers");

-- CreateIndex
CREATE INDEX "contacts_emails_idx" ON "contacts" USING GIN ("emails");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_ownerId_name_key" ON "contacts"("ownerId", "name");

-- CreateIndex
CREATE INDEX "users_previousEmails_idx" ON "users" USING GIN ("previousEmails");

-- CreateIndex
CREATE INDEX "users_previousPhoneNumbers_idx" ON "users" USING GIN ("previousPhoneNumbers");

-- AddForeignKey
ALTER TABLE "humlinkers" ADD CONSTRAINT "humlinkers_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "humlinkers" ADD CONSTRAINT "humlinkers_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_humhlinkerId_fkey" FOREIGN KEY ("humhlinkerId") REFERENCES "humlinkers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_humhlinkerId_fkey" FOREIGN KEY ("humhlinkerId") REFERENCES "humlinkers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
