-- The order book: a FutureJob now holds everything the New Job form asks for,
-- so an order booked today becomes a production job without retyping.
-- Every column is nullable or defaulted — existing backlog rows stay valid.
ALTER TABLE "FutureJob" ADD COLUMN     "buyerName" TEXT;
ALTER TABLE "FutureJob" ADD COLUMN     "poNumber" TEXT;
ALTER TABLE "FutureJob" ADD COLUMN     "expectedCompletion" TIMESTAMP(3);
ALTER TABLE "FutureJob" ADD COLUMN     "finishedWeightKg" DOUBLE PRECISION;
ALTER TABLE "FutureJob" ADD COLUMN     "reminderDaysBefore" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "FutureJob" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FutureJob" ADD COLUMN     "templateId" TEXT;
ALTER TABLE "FutureJob" ADD COLUMN     "stagesText" TEXT;

-- The order book column on the dashboard reads these unit-wise.
CREATE INDEX "FutureJob_unitId_idx" ON "FutureJob"("unitId");
