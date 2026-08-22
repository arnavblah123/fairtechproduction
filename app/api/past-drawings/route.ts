import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { unitScope } from "@/lib/permissions";
import { formatDate, jobCode } from "@/lib/format";

// Earlier jobs whose drawings can be reused. Used both from the job page
// (pass ?exclude=<this job> so a job is never offered its own drawing) and
// from the New Job form, where no job exists yet.
//
// Fetched on demand — only when someone actually opens the picker — because
// this scans every job that has a drawing.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const exclude = req.nextUrl.searchParams.get("exclude");
  const jobsRaw = await db.job.findMany({
    where: {
      ...(exclude ? { id: { not: exclude } } : {}),
      attachments: { some: { kind: "DRAWING" } },
      ...unitScope(user),
    },
    select: {
      id: true,
      jobNumber: true,
      description: true,
      clientName: true,
      createdAt: true,
      finishedWeightKg: true,
      unit: { select: { code: true } },
      attachments: {
        where: { kind: { in: ["DRAWING", "BOM"] } },
        select: { id: true, filename: true, mimeType: true, kind: true },
      },
    },
    orderBy: { jobNumber: "desc" },
    take: 100,
  });

  const jobs = jobsRaw.map((j) => ({
    jobId: j.id,
    label: `${jobCode(j.jobNumber)} ${j.description} — ${j.clientName} (${j.unit.code}, ${formatDate(j.createdAt)})`,
    // The same part built again weighs the same — offered with the drawing.
    finishedWeightKg: j.finishedWeightKg,
    drawings: j.attachments.filter((a) => a.kind === "DRAWING"),
    boms: j.attachments.filter((a) => a.kind === "BOM"),
  }));
  return NextResponse.json({ jobs });
}
