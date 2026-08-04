-- Issue resolve-by date (shown in the WhatsApp alert)
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);

-- Purchase / HR role: Labour app, issues and planning only
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PURCHASE_HR';
