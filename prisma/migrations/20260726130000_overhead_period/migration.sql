CREATE TYPE "OverheadPeriod" AS ENUM ('MONTHLY', 'ANNUAL');
ALTER TABLE "OverheadItem" ADD COLUMN "period" "OverheadPeriod" NOT NULL DEFAULT 'MONTHLY';
