import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Overheads, all with the same day-spread rule: a daily cost is split
// equally between the jobs that had any work logged that IST calendar day,
// and a job's share is the sum of its slices across every day it ran.
//
// Three sources:
//  - Supervisor punch-ins: monthlySalary / 30 per punched day, spread over
//    that unit's jobs running that day.
//  - Fixed OverheadItems (rent, electricity, ...): amount / 30 per day for
//    monthly items, amount / 360 for annual ones, between effectiveFrom and
//    endedAt — spread over the pooled jobs of the item's selected units
//    that day (no selected units = all units).
//  - Worker ESI/PF lump sums: esiPfMonthly / 30 per day the worker logged
//    any job time, split over the jobs that worker was on that day.

// Today's IST calendar date, normalised to what @db.Date stores.
export function istToday(): Date {
  return new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
}

export async function overheadByJob(jobIds: string[]): Promise<Map<string, number>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ jobId: string; overhead: number }[]>(Prisma.sql`
    WITH day_jobs AS (
      -- The unit comes from the TimeLog itself, not the job's current
      -- unitId: a job moved to another unit later must not retroactively
      -- change which unit's supervisor salary / fixed overheads it (or its
      -- former unit-mates) were pooled against on days that already happened.
      SELECT DISTINCT
        (l."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS d,
        l."unitId" AS unit,
        l."jobId" AS job
      FROM "TimeLog" l
      WHERE l."jobId" IS NOT NULL
    ),
    counts_unit AS (
      SELECT d, unit, count(*)::float AS njobs FROM day_jobs GROUP BY d, unit
    ),
    -- fixed items matched to the day-jobs they cover (their units, or all)
    item_days AS (
      SELECT o.id AS item, o."monthlyAmount", o."period", dj.d, dj.job
      FROM "OverheadItem" o
      JOIN day_jobs dj ON o."effectiveFrom" <= dj.d
        AND (o."endedAt" IS NULL OR o."endedAt" >= dj.d)
        AND (
          NOT EXISTS (SELECT 1 FROM "OverheadItemUnit" iu WHERE iu."itemId" = o.id)
          OR EXISTS (
            SELECT 1 FROM "OverheadItemUnit" iu
            WHERE iu."itemId" = o.id AND iu."unitId" = dj.unit
          )
        )
    ),
    item_day_pool AS (
      SELECT item, d, count(*)::float AS njobs FROM item_days GROUP BY item, d
    ),
    -- worker ESI/PF: which jobs each worker touched per day
    emp_days AS (
      SELECT DISTINCT
        (l."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS d,
        l."employeeId" AS emp,
        l."jobId" AS job
      FROM "TimeLog" l
      WHERE l."jobId" IS NOT NULL
    ),
    emp_day_pool AS (
      SELECT d, emp, count(*)::float AS njobs FROM emp_days GROUP BY d, emp
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

      -- fixed overheads over their selected units' pooled jobs
      SELECT idr.job,
        (idr."monthlyAmount" / (CASE WHEN idr."period" = 'ANNUAL' THEN 360.0 ELSE 30.0 END))
          / p.njobs
      FROM item_days idr
      JOIN item_day_pool p ON p.item = idr.item AND p.d = idr.d

      UNION ALL

      -- worker ESI/PF lump sums over the jobs that worker was on that day
      SELECT ed.job, (e."esiPfMonthly" / 30.0) / ep.njobs
      FROM emp_days ed
      JOIN emp_day_pool ep ON ep.d = ed.d AND ep.emp = ed.emp
      JOIN "Employee" e ON e.id = ed.emp
      WHERE e."esiPfMonthly" IS NOT NULL
    )
    SELECT job AS "jobId", sum(amt)::float AS overhead
    FROM parts
    WHERE job IN (${Prisma.join(jobIds)})
    GROUP BY job
  `);
  return new Map(rows.map((r) => [r.jobId, Number(r.overhead)]));
}
