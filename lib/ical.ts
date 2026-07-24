import { jobCode } from "@/lib/format";

// iCal builder for the owner's private calendar feed: one all-day event per
// job deadline (with a reminder) and one per estimated dispatch date.

type FeedJob = {
  id: string;
  jobNumber: number;
  clientName: string;
  description: string;
  unitName: string;
  expectedCompletion: Date;
  reminderDaysBefore: number;
  estimatedDispatchAt: Date | null;
};

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function icsDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function vevent(
  uid: string,
  date: Date,
  summary: string,
  description: string,
  reminderDays?: number
): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}@fairtech-production`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART;VALUE=DATE:${icsDateOnly(date)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
  ];
  if (reminderDays !== undefined) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(`Reminder: ${summary}`)}`,
      `TRIGGER:-P${Math.max(0, reminderDays)}D`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

type PlanTarget = { id: string; targetDate: Date; summary: string };

export function buildOwnerCalendar(jobs: FeedJob[], planTargets: PlanTarget[] = []): string {
  const events: string[] = [];
  for (const t of planTargets) {
    events.push(vevent(`plan-${t.id}`, t.targetDate, t.summary, "Planning target.", 1));
  }
  for (const j of jobs) {
    const code = jobCode(j.jobNumber);
    events.push(
      vevent(
        `due-${j.id}`,
        j.expectedCompletion,
        `⏰ ${code} due: ${j.clientName} — ${j.description}`,
        `Unit: ${j.unitName}\nPromised completion date.`,
        j.reminderDaysBefore
      )
    );
    if (j.estimatedDispatchAt) {
      events.push(
        vevent(
          `dispatch-${j.id}`,
          j.estimatedDispatchAt,
          `🚚 ${code} dispatch: ${j.clientName} — ${j.description}`,
          `Unit: ${j.unitName}\nEstimated dispatch (set at Final Done).`,
          1
        )
      );
    }
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fairtech//Production Planner//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Fairtech Jobs",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}
