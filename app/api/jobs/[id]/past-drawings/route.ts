import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { unitScope } from "@/lib/permissions";
import { formatDate, jobCode } from "@/lib/format";

// Earlier jobs whose drawings can be reused on this one. Split out of the job
// page itself (which used to run this on every single view) so the cost only
// falls on the rare moment someone actually opens the reuse picker.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const jobsRaw = await db.job.findMany({
    where: {
      id: { not: id },
      attachments: { some: { kind: "DRAWING" } },
      ...unitScope(user),
    },
    select: {
      id: true,
      jobNumber: true,
      description: true,
      clientName: true,
      createdAt: true,
      unit: { select: { code: true } },
      attachments: {
        where: { kind: "DRAWING" },
        select: { id: true, filename: true, mimeType: true },
      },
    },
    orderBy: { jobNumber: "desc" },
    take: 100,
  });

  const jobs = jobsRaw.map((j) => ({
    jobId: j.id,
    label: `${jobCode(j.jobNumber)} ${j.description} — ${j.clientName} (${j.unit.code}, ${formatDate(j.createdAt)})`,
    drawings: j.attachments,
  }));
  return NextResponse.json({ jobs });
}
