-- Delay blamed on a worker: recorded as a complaint from the late-target form
CREATE TABLE IF NOT EXISTS "LabourComplaint" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "jobId" TEXT,
  "planItemId" TEXT,
  "stageName" TEXT,
  "reason" TEXT NOT NULL,
  "raisedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabourComplaint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LabourComplaint_employeeId_createdAt_idx" ON "LabourComplaint"("employeeId", "createdAt");
CREATE INDEX IF NOT EXISTS "LabourComplaint_jobId_idx" ON "LabourComplaint"("jobId");
DO $$ BEGIN
  ALTER TABLE "LabourComplaint" ADD CONSTRAINT "LabourComplaint_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LabourComplaint" ADD CONSTRAINT "LabourComplaint_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LabourComplaint" ADD CONSTRAINT "LabourComplaint_raisedById_fkey"
    FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
