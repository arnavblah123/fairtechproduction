-- Crane: which job it was called for
ALTER TABLE "CraneLog" ADD COLUMN "jobId" TEXT;
ALTER TABLE "CraneLog" ADD CONSTRAINT "CraneLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Worker ESI/PF lump sum
ALTER TABLE "Employee" ADD COLUMN "esiPfMonthly" DOUBLE PRECISION;

-- Material availability question at job creation
ALTER TABLE "Job" ADD COLUMN "materialReady" BOOLEAN NOT NULL DEFAULT true;

-- Overheads: any subset of units instead of one-or-all
CREATE TABLE "OverheadItemUnit" (
    "itemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "OverheadItemUnit_pkey" PRIMARY KEY ("itemId", "unitId")
);
ALTER TABLE "OverheadItemUnit" ADD CONSTRAINT "OverheadItemUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OverheadItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OverheadItemUnit" ADD CONSTRAINT "OverheadItemUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "OverheadItemUnit" ("itemId", "unitId")
  SELECT id, "unitId" FROM "OverheadItem" WHERE "unitId" IS NOT NULL;
ALTER TABLE "OverheadItem" DROP COLUMN "unitId";
