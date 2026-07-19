-- AlterEnum
ALTER TYPE "WorkActivity" ADD VALUE 'PLATE_CUTTING';
ALTER TYPE "WorkActivity" ADD VALUE 'STRUCTURAL_CUTTING';

-- CreateTable
CREATE TABLE "CraneLog" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "purpose" "WorkActivity" NOT NULL,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startedById" TEXT NOT NULL,
    "endedById" TEXT,
    CONSTRAINT "CraneLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CraneLog_unitId_endedAt_idx" ON "CraneLog"("unitId", "endedAt");

-- AddForeignKey
ALTER TABLE "CraneLog" ADD CONSTRAINT "CraneLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CraneLog" ADD CONSTRAINT "CraneLog_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CraneLog" ADD CONSTRAINT "CraneLog_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
