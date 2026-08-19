-- Drawings can now hang off an order-book entry that has no job yet.
-- Exactly one of jobId / futureJobId is set; releasing an order moves the
-- row onto the new job instead of copying the bytes.
ALTER TABLE "JobAttachment" ALTER COLUMN "jobId" DROP NOT NULL;
ALTER TABLE "JobAttachment" ADD COLUMN "futureJobId" TEXT;

ALTER TABLE "JobAttachment"
  ADD CONSTRAINT "JobAttachment_futureJobId_fkey"
  FOREIGN KEY ("futureJobId") REFERENCES "FutureJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "JobAttachment_futureJobId_idx" ON "JobAttachment"("futureJobId");
