import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Supervisor-salary overheads.
//
// Every punched-in supervisor day costs monthlySalary / 30. That day-cost is
// split equally between all jobs of that unit that had any work logged on
// that IST calendar day — so a job's overhead share is the sum of its slices
// across every day it was worked on.

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
    counts AS (
      SELECT d, unit, count(*)::float AS njobs FROM day_jobs GROUP BY d, unit
    ),
    sup AS (
      SELECT sd."date" AS d, sd."unitId" AS unit, sum(u."monthlySalary" / 30.0) AS cost
      FROM "SupervisorDay" sd
      JOIN "User" u ON u.id = sd."userId"
      WHERE u."monthlySalary" IS NOT NULL
      GROUP BY sd."date", sd."unitId"
    )
    SELECT dj.job AS "jobId", sum(s.cost / c.njobs)::float AS overhead
    FROM day_jobs dj
    JOIN counts c ON c.d = dj.d AND c.unit = dj.unit
    JOIN sup s ON s.d = dj.d AND s.unit = dj.unit
    WHERE dj.job IN (${Prisma.join(jobIds)})
    GROUP BY dj.job
  `);
  return new Map(rows.map((r) => [r.jobId, Number(r.overhead)]));
}
