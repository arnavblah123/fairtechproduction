-- Indexes for the queries every page load actually runs.
-- Open clocks per unit (dashboard duty list, overnight to-do check).
CREATE INDEX IF NOT EXISTS "TimeLog_unitId_endedAt_idx" ON "TimeLog"("unitId", "endedAt");
-- Date-window scans: reports, history, overhead spreading.
CREATE INDEX IF NOT EXISTS "TimeLog_startedAt_idx" ON "TimeLog"("startedAt");
-- The morning list reads open to-dos on every dashboard load.
CREATE INDEX IF NOT EXISTS "TodoItem_done_unitId_idx" ON "TodoItem"("done", "unitId");
CREATE INDEX IF NOT EXISTS "TodoItem_jobId_done_idx" ON "TodoItem"("jobId", "done");
-- The Labour Requests page filters issues by type.
CREATE INDEX IF NOT EXISTS "Issue_type_status_idx" ON "Issue"("type", "status");
