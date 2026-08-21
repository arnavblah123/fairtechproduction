import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { unitScope } from "@/lib/permissions";
import { formatDate, jobCode } from "@/lib/format";

// What this job name used last time. The same part is built for the same
// customer again and again, so once a job name has been used the process and
// the drawings are usually the same — but "usually" is not "always", which is
// why the form asks rather than assumes.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const name = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (name.length < 2) return NextResponse.json({ found: false });

  // Most recent job carrying this name, within what the user may see.
  const previous = await db.job.findFirst({
    where: {
      description: { equals: name, mode: "insensitive" },
      ...unitScope(user),
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      createdAt: true,
      templateId: true,
      template: { select: { id: true, name: true, stages: { orderBy: { sequence: "asc" }, select: { name: true } } } },
      stages: { orderBy: { sequence: "asc" }, select: { name: true } },
      attachments: { select: { kind: true, filename: true } },
    },
    orderBy: { jobNumber: "desc" },
  });
  if (!previous) return NextResponse.json({ found: false });

  const drawings = previous.attachments.filter((a) => a.kind === "DRAWING");
  const boms = previous.attachments.filter((a) => a.kind === "BOM");

  return NextResponse.json({
    found: true,
    jobId: previous.id,
    label: `${jobCode(previous.jobNumber)} · ${previous.clientName} · ${formatDate(previous.createdAt)}`,
    templateId: previous.template?.id ?? null,
    templateName: previous.template?.name ?? null,
    // The stages as they were actually run last time — a job's stage list is
    // edited per job, so this beats the template it started from.
    stageNames: previous.stages.map((s) => s.name),
    drawings: drawings.map((a) => a.filename),
    boms: boms.map((a) => a.filename),
  });
}
