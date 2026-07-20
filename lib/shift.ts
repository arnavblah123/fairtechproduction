import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

// Night-plan cutoffs (IST): "till 10 PM" = 22:00, "full night" = 02:30.
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

export function shiftPlanEnd(plan: "TEN_PM" | "FULL_NIGHT"): Date {
  return plan === "TEN_PM" ? nextIstTime(22, 0) : nextIstTime(2, 30);
}

// Label a stored plannedEndAt for display ("10 PM" / "2:30 AM").
export function shiftPlanLabel(plannedEndAt: Date): string {
  const istHour = new Date(plannedEndAt.getTime() + IST_MS).getUTCHours();
  return istHour === 22 ? "till 10 PM" : "full night (2:30 AM)";
}

// Close every open clock whose cutoff has passed — the recorded end time is
// the cutoff itself, not when this sweep happened to run. Called by the
// scheduled cron and lazily on dashboard loads.
export async function closeOverdueShifts(): Promise<number> {
  const count = await db.$executeRaw(
    Prisma.sql`UPDATE "TimeLog"
       SET "endedAt" = "plannedEndAt", "endSource" = 'AUTO_SHIFT_END'
       WHERE "endedAt" IS NULL AND "plannedEndAt" <= ${new Date()}`
  );
  if (count > 0) {
    await audit(null, "timelog.shiftEnd", "TimeLog", "sweep", { closed: count });
  }
  return count;
}
