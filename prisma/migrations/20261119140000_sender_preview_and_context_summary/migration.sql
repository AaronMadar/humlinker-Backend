-- AlterTable
ALTER TABLE "humlinkers" ADD COLUMN     "contextSummary" TEXT,
ADD COLUMN     "contextSummaryUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN     "senderPreview" TEXT NOT NULL DEFAULT '';

