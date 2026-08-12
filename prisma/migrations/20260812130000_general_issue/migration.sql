-- Factory-level problems that belong to no job (electricity, crane vendor,
-- water…). Kept apart from the job Issue table on purpose.
CREATE TABLE IF NOT EXISTS "GeneralIssue" (
    "id" TEXT NOT NULL,
    "unitId" TEXT,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "raisedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GeneralIssue_status_createdAt_idx" ON "GeneralIssue"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "GeneralIssue" ADD CONSTRAINT "GeneralIssue_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GeneralIssue" ADD CONSTRAINT "GeneralIssue_raisedById_fkey"
    FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GeneralIssue" ADD CONSTRAINT "GeneralIssue_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
