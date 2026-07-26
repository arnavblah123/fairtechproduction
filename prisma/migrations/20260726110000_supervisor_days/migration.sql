ALTER TABLE "User" ADD COLUMN "monthlySalary" DOUBLE PRECISION;

CREATE TABLE "SupervisorDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupervisorDay_userId_date_key" ON "SupervisorDay"("userId", "date");
CREATE INDEX "SupervisorDay_unitId_date_idx" ON "SupervisorDay"("unitId", "date");

ALTER TABLE "SupervisorDay" ADD CONSTRAINT "SupervisorDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupervisorDay" ADD CONSTRAINT "SupervisorDay_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
