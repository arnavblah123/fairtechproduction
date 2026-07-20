import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";

// Read-only export for the Fairtech Store (consumables inventory) system.
// The inventory app polls this to mirror jobs and pull per-job labour hours,
// which it uses to allocate shared consumable costs across jobs.
//
// Auth: set INTEGRATION_EXPORT_KEY in env; caller sends it as x-integration-key.
export async function GET(req: NextRequest) {
  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "INTEGRATION_EXPORT_KEY is not configured on the production app" },
      { status: 503 }
    );
  }
  if (req.headers.get("x-integration-key") !== key) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    include: { unit: { select: { code: true } } },
    orderBy: { jobNumber: "asc" },
  });

  // Sum ended time-log hours per job per month (IST) — open logs are excluded
  // until they end, so numbers only ever grow monotonically.
  const logs = await prisma.timeLog.findMany({
    where: { jobId: { not: null }, endedAt: { not: null } },
    select: { jobId: true, startedAt: true, endedAt: true },
  });
  const jobNumberById = new Map(jobs.map((j) => [j.id, j.jobNumber]));
  const IST_MS = 5.5 * 3600 * 1000;
  const agg = new Map<string, number>();
  for (const l of logs) {
    const jobNumber = jobNumberById.get(l.jobId!);
    if (jobNumber === undefined) continue;
    const ist = new Date(l.startedAt.getTime() + IST_MS);
    const month = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
    const hours = (l.endedAt!.getTime() - l.startedAt.getTime()) / 3600000;
    if (hours <= 0) continue;
    const k = `${jobNumber}|${month}`;
    agg.set(k, (agg.get(k) || 0) + hours);
  }

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    jobs: jobs.map((j) => ({
      jobNumber: j.jobNumber,
      clientName: j.clientName,
      description: j.description,
      poNumber: j.poNumber,
      unitCode: j.unit.code,
      status: j.status,
      completedAt: j.completedAt,
    })),
    hours: [...agg.entries()].map(([k, hours]) => {
      const [jobNumber, month] = k.split("|");
      return { jobNumber: Number(jobNumber), month, hours: Math.round(hours * 100) / 100 };
    }),
  });
}
