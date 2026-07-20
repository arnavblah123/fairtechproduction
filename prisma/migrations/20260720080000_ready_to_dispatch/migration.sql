-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'READY_TO_DISPATCH';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "estimatedDispatchAt" TIMESTAMP(3);
