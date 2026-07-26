import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Overheads, all with the same day-spread rule: a daily cost is split
// equally between the jobs that had any work logged that IST calendar day,
// and a job's share is the sum of its slices across every day it ran.
//
// Two sources:
//  - Supervisor punch-ins: monthlySalary / 30 per punched day, spread over
//    that unit's jobs running that day.
//  - Fixed OverheadItems (rent, electricity, ...): amount / 30 per day for
//    monthly items, amount / 360 for annual ones, between effectiveFrom and
//    endedAt — unit items spread over that unit's jobs, company-wide items
//    over all units' jobs that day.

// Today's IST calendar date, normalised to what @db.Date stores.
export function istToday(): Date {
  return new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
}

export async function overheadByJob(jobIds: string[]): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ jobId: string; overhead: number }[]>(Prisma.sql`
    WITH day_jobs AS (
      SELECT DISTINCT
        (l."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS d,
        j."unitId" AS unit,
        l."jobId" AS job
      FROM "TimeLog" l
      JOIN "Job" j ON j.id = l."jobId"
      WHERE l."jobId" IS NOT NULL
    ),
    counts_unit AS (
      SELECT d, unit, count(*)::float AS njobs FROM day_jobs GROUP BY d, unit
    ),
    counts_all AS (
      SELECT d, count(*)::float AS njobs FROM day_jobs GROUP BY d
    ),
    parts AS (
      -- punched-in supervisor salaries
      SELECT dj.job AS job, s.cost / cu.njobs AS amt
      FROM day_jobs dj
      JOIN counts_unit cu ON cu.d = dj.d AND cu.unit = dj.unit
      JOIN (
        SELECT sd."date" AS d, sd."unitId" AS unit, sum(u."monthlySalary" / 30.0) AS cost
        FROM "SupervisorDay" sd
        JOIN "User" u ON u.id = sd."userId"
        WHERE u."monthlySalary" IS NOT NULL
        GROUP BY sd."date", sd."unitId"
      ) s ON s.d = dj.d AND s.unit = dj.unit

      UNION ALL

      -- unit-specific fixed overheads (rent, electricity, ...)
      SELECT dj.job,
        (o."monthlyAmount" / (CASE WHEN o."period" = 'ANNUAL' THEN 360.0 ELSE 30.0 END)) / cu.njobs
      FROM day_jobs dj
      JOIN counts_unit cu ON cu.d = dj.d AND cu.unit = dj.unit
      JOIN "OverheadItem" o ON o."unitId" = dj.unit
        AND o."effectiveFrom" <= dj.d
        AND (o."endedAt" IS NULL OR o."endedAt" >= dj.d)

      UNION ALL

      -- company-wide fixed overheads, spread over all units' jobs that day
      SELECT dj.job,
        (o."monthlyAmount" / (CASE WHEN o."period" = 'ANNUAL' THEN 360.0 ELSE 30.0 END)) / ca.njobs
      FROM day_jobs dj
      JOIN counts_all ca ON ca.d = dj.d
      JOIN "OverheadItem" o ON o."unitId" IS NULL
        AND o."effectiveFrom" <= dj.d
        AND (o."endedAt" IS NULL OR o."endedAt" >= dj.d)
    )
    SELECT job AS "jobId", sum(amt)::float AS overhead
    FROM parts
    WHERE job IN (${Prisma.join(jobIds)})
    GROUP BY job
  `);
  return new Map(rows.map((r) => [r.jobId, Number(r.overhead)]));
}
