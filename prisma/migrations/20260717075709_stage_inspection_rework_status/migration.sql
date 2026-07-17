-- AlterEnum
ALTER TYPE "StageStatus" ADD VALUE 'REWORK';

-- AlterTable
ALTER TABLE "Stage" ADD COLUMN     "inspectedAt" TIMESTAMP(3),
ADD COLUMN     "inspectedBy" TEXT;
