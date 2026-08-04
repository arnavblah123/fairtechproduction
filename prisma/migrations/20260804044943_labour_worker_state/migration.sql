-- CreateTable
CREATE TABLE "LabourWorkerState" (
    "seekerId" TEXT NOT NULL,
    "phone" TEXT,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LabourWorkerState_pkey" PRIMARY KEY ("seekerId")
);

-- CreateIndex
CREATE INDEX "LabourWorkerState_updatedAt_idx" ON "LabourWorkerState"("updatedAt");

