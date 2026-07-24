import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildOwnerCalendar } from "@/lib/ical";

// Owner's private calendar feed. The URL contains a long random token known
// only to the superadmin (shown on the Planner page); calendar apps poll it.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const stored = await db.setting.findUnique({ where: { key: "calendar.feedToken" } });
  if (!stored || !token || token !== stored.value) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [jobs, planItems] = await Promise.all([
    db.job.findMany({
      where: { status: { not: "COMPLETED" } },
      include: { unit: { select: { name: true } } },
      orderBy: { expectedCompletion: "asc" },
    }),
    // Plan targets from recent plans that aren't finished yet.
    db.planItem.findMany({
      where: {
        done: false,
        plan: { endDate: { gte: new Date(Date.now() - 30 * 86400000) } },
        OR: [{ stageId: null }, { stage: { status: { not: "DONE" } } }],
      },
      include: {
        job: { select: { jobNumber: true, clientName: true } },
        stage: { select: { sequence: true } },
      },
      orderBy: { targetDate: "asc" },
    }),
  ]);

  const ics = buildOwnerCalendar(
    jobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      clientName: j.clientName,
      description: j.description,
      unitName: j.unit.name,
      expectedCompletion: j.expectedCompletion,
      reminderDaysBefore: j.reminderDaysBefore,
      estimatedDispatchAt: j.estimatedDispatchAt,
    })),
    planItems.map((i) => ({
      id: i.id,
      targetDate: i.targetDate,
      summary: `📋 Plan: ${i.stage ? `${i.stage.sequence}. ` : ""}${i.description}${
        i.job ? ` — ${i.job.clientName}` : ""
      }`,
    }))
  );

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
