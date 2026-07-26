CREATE TABLE "OverheadItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyAmount" DOUBLE PRECISION NOT NULL,
    "unitId" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "endedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverheadItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OverheadItem" ADD CONSTRAINT "OverheadItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
