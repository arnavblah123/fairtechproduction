-- AlterEnum
ALTER TYPE "LogSource" ADD VALUE 'AUTO_SHIFT_END';

-- AlterTable
ALTER TABLE "TimeLog" ADD COLUMN "plannedEndAt" TIMESTAMP(3);
