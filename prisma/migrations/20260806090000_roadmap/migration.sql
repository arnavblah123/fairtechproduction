-- Manufacturing road map (FTE/PRD/RM): planned bar per activity
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "plannedStart" TIMESTAMP(3);
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "plannedEnd" TIMESTAMP(3);
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "roadmapNote" TEXT;

-- Who is planned to work on each activity
CREATE TABLE IF NOT EXISTS "StagePlanWorker" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StagePlanWorker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StagePlanWorker_stageId_employeeId_key"
  ON "StagePlanWorker"("stageId", "employeeId");
CREATE INDEX IF NOT EXISTS "StagePlanWorker_employeeId_idx" ON "StagePlanWorker"("employeeId");

DO $$ BEGIN
  ALTER TABLE "StagePlanWorker" ADD CONSTRAINT "StagePlanWorker_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StagePlanWorker" ADD CONSTRAINT "StagePlanWorker_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
