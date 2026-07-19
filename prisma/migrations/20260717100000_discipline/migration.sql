-- CreateEnum
CREATE TYPE "DisciplineReason" AS ENUM ('DRINKING', 'TIMEPASS', 'TOBACCO', 'OTHER');

-- CreateTable
CREATE TABLE "Discipline" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "reason" "DisciplineReason" NOT NULL,
    "hoursCut" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "raisedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Discipline_employeeId_createdAt_idx" ON "Discipline"("employeeId", "createdAt");
CREATE INDEX "Discipline_unitId_createdAt_idx" ON "Discipline"("unitId", "createdAt");

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
