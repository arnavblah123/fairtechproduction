-- "PO not received yet": pauses the daily reminder without losing the chase
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "poAwaited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "poAwaitedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "poExpectedBy" TIMESTAMP(3);
