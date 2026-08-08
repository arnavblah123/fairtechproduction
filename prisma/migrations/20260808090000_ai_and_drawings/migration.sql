-- Drawing reuse: which job a reused drawing came from, and jobs whose
-- drawing may have changed (work must not proceed on the wrong one)
ALTER TABLE "JobAttachment" ADD COLUMN IF NOT EXISTS "sourceJobId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "drawingPending" BOOLEAN NOT NULL DEFAULT false;

-- Every tool call the assistant / monitoring agent makes
CREATE TABLE IF NOT EXISTS "ai_tool_calls" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "runId" TEXT,
  "userId" TEXT,
  "toolName" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "errorText" TEXT,
  "ms" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_tool_calls_source_createdAt_idx" ON "ai_tool_calls"("source", "createdAt");

-- What the scheduled monitoring agent found
CREATE TABLE IF NOT EXISTS "daily_findings" (
  "id" TEXT NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "day" DATE NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "reference" TEXT,
  "jobId" TEXT,
  "acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_findings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "daily_findings_day_severity_idx" ON "daily_findings"("day", "severity");
DO $$ BEGIN
  ALTER TABLE "daily_findings" ADD CONSTRAINT "daily_findings_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
