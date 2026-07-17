-- CreateTable
CREATE TABLE "JobTest" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stageId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobTest_jobId_idx" ON "JobTest"("jobId");

-- CreateIndex
CREATE INDEX "JobTest_stageId_idx" ON "JobTest"("stageId");

-- AddForeignKey
ALTER TABLE "JobTest" ADD CONSTRAINT "JobTest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTest" ADD CONSTRAINT "JobTest_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
