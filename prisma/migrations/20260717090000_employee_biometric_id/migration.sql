-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "biometricId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_biometricId_key" ON "Employee"("biometricId");
