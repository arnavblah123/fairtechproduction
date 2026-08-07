-- Long holidays asked for by workers, recorded by supervisors
CREATE TABLE IF NOT EXISTS "LeavePeriod" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "markedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeavePeriod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeavePeriod_employeeId_fromDate_idx" ON "LeavePeriod"("employeeId", "fromDate");
DO $$ BEGIN
  ALTER TABLE "LeavePeriod" ADD CONSTRAINT "LeavePeriod_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "LeavePeriod" ADD CONSTRAINT "LeavePeriod_markedById_fkey"
    FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
