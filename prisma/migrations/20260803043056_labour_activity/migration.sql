-- CreateTable
CREATE TABLE "LabourActivity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabourActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabourSnapshot" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabourSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabourActivity_clientId_key" ON "LabourActivity"("clientId");

-- CreateIndex
CREATE INDEX "LabourActivity_occurredAt_idx" ON "LabourActivity"("occurredAt");

