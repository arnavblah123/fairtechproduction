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

  const jobs = await db.job.findMany({
    where: { status: { not: "COMPLETED" } },
    include: { unit: { select: { name: true } } },
    orderBy: { expectedCompletion: "asc" },
  });

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
    }))
  );

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
