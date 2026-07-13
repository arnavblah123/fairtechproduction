import { jobCode } from "@/lib/format";

type CalendarJob = {
  id: string;
  jobNumber: number;
  clientName: string;
  description: string;
  expectedCompletion: Date;
  reminderDaysBefore: number;
  unitName: string;
};

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function icsDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// All-day event on the expected completion date, with a VALARM reminder
// `reminderDaysBefore` days earlier. Subscribable in Google Calendar, Apple
// Calendar and Outlook (spec §4 — calendar entry + configurable reminder).
export function jobToVevent(job: CalendarJob): string {
  const uid = `job-${job.id}@fairtech-production`;
  const summary = `${jobCode(job.jobNumber)} due: ${job.clientName} — ${job.description}`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART;VALUE=DATE:${icsDateOnly(job.expectedCompletion)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(`Unit: ${job.unitName}\nExpected completion for ${job.clientName}.`)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Reminder: ${summary}`)}`,
    `TRIGGER:-P${Math.max(0, job.reminderDaysBefore)}D`,
    "END:VALARM",
    "END:VEVENT",
  ].join("\r\n");
}

export function buildCalendar(jobs: CalendarJob[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fairtech//Production Dashboard//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Fairtech Job Deadlines",
    ...jobs.map(jobToVevent),
    "END:VCALENDAR",
  ].join("\r\n");
}
