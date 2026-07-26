import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

// Night-plan cutoffs (IST): "till 8 PM" = 20:00, "till 10 PM" = 22:00,
// "full night" = 02:30. Full-night shifts closed at their cutoff earn a
// +4 hour OT credit in all hour/cost totals.
const IST_MS = 5.5 * 3600e3;

// Next occurrence of an IST wall-clock time as a real Date.
export function nextIstTime(hour: number, minute: number): Date {
  const nowIst = new Date(Date.now() + IST_MS);
  const target = new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), hour, minute) - IST_MS
  );
  if (target.getTime() <= Date.now()) target.setUTCDate(target.getUTCDate() + 1);
  return target;
}

export function shiftPlanEnd(plan: "EIGHT_PM" | "TEN_PM" | "FULL_NIGHT"): Date {
  if (plan === "EIGHT_PM") return nextIstTime(20, 0);
  return plan === "TEN_PM" ? nextIstTime(22, 0) : nextIstTime(2, 30);
}

// Label a stored plannedEndAt for display ("8 PM" / "10 PM" / "2:30 AM").
export function shiftPlanLabel(plannedEndAt: Date): string {
  const istHour = new Date(plannedEndAt.getTime() + IST_MS).getUTCHours();
  if (istHour === 20) return "till 8 PM";
  return istHour === 22 ? "till 10 PM" : "full night (2:30 AM)";
}

// Close every open clock whose cutoff has passed — the recorded end time is
// the cutoff itself, not when this sweep happened to run. Called by the
// scheduled cron and lazily on dashboard loads. Full-night clocks (2:30 AM
// cutoff, IST hour = 2) get the +4h OT credit as they close.
export async function closeOverdueShifts(): Promise<number> {
  const count = await db.$executeRaw(
    Prisma.sql`UPDATE "TimeLog"
       SET "endedAt" = "plannedEndAt", "endSource" = 'AUTO_SHIFT_END',
           "otBonusMinutes" = CASE
             WHEN EXTRACT(HOUR FROM ("plannedEndAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')) = 2
             THEN 240 ELSE 0 END
       WHERE "endedAt" IS NULL AND "plannedEndAt" <= ${new Date()}`
  );
  if (count > 0) {
    await audit(null, "timelog.shiftEnd", "TimeLog", "sweep", { closed: count });
  }
  return count;
}
