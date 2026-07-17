-- CreateTable
CREATE TABLE "StageRework" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageRework_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StageRework_stageId_idx" ON "StageRework"("stageId");

-- CreateIndex
CREATE INDEX "StageRework_jobId_idx" ON "StageRework"("jobId");

-- AddForeignKey
ALTER TABLE "StageRework" ADD CONSTRAINT "StageRework_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageRework" ADD CONSTRAINT "StageRework_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageRework" ADD CONSTRAINT "StageRework_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
