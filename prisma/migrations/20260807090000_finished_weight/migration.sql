-- Finished weight of the job in kg, for per-kg budgeting
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "finishedWeightKg" DOUBLE PRECISION;
