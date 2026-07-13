import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { unitScope } from "@/lib/permissions";
import { buildCalendar } from "@/lib/ical";

// iCal feed of expected completion dates for all non-completed jobs the
// current user can see. Download or subscribe from a calendar app.
// TODO(config): direct Google Calendar API push is a possible upgrade once
// the target calendar account is confirmed — see README "Calendar".
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await db.job.findMany({
    where: { status: { not: "COMPLETED" }, ...unitScope(user) },
    include: { unit: true },
    orderBy: { expectedCompletion: "asc" },
  });

  const ics = buildCalendar(
    jobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      clientName: j.clientName,
      description: j.description,
      expectedCompletion: j.expectedCompletion,
      reminderDaysBefore: j.reminderDaysBefore,
      unitName: j.unit.name,
    }))
  );

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fairtech-jobs.ics"',
    },
  });
}
