CREATE TABLE "LeaveDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "markedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveDay_employeeId_date_key" ON "LeaveDay"("employeeId", "date");
ALTER TABLE "LeaveDay" ADD CONSTRAINT "LeaveDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
