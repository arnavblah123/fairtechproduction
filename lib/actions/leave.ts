"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess, isAdmin } from "@/lib/permissions";
import { formatDate } from "@/lib/format";

// Long holidays: a worker asks, the supervisor records it here. Every date
// in the range becomes a leave day, so the daily off-list stops asking about
// him and the labour app's feed shows him away. Jagdish and the owner get a
// WhatsApp the moment it is recorded.

const DAY = 86400000;

// Midnight of an IST calendar date, stored the way LeaveDay expects.
function istDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

export async function recordLongLeave(formData: FormData) {
  const user = await requireUser();
  const employeeId = String(formData.get("employeeId") ?? "");
  const from = istDate(String(formData.get("fromDate") ?? ""));
  const to = istDate(String(formData.get("toDate") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!employeeId || !from || !to || !reason) return;
  if (to.getTime() < from.getTime()) return;
  // Guard against a typo turning into hundreds of leave rows.
  const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
  if (days > 180) return;

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { primaryUnit: { select: { name: true, code: true } } },
  });
  assertUnitAccess(user, employee.primaryUnitId);

  const period = await db.leavePeriod.create({
    data: { employeeId, fromDate: from, toDate: to, reason, markedById: user.id },
  });

  // One leave day per date — what the off-list and the labour feed read.
  for (let i = 0; i < days; i++) {
    const date = new Date(from.getTime() + i * DAY);
    await db.leaveDay.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: {
        employeeId,
        date,
        reason: "INFORMED_LEAVE",
        note: `Long leave: ${reason}`,
        markedBy: user.name,
      },
      update: { reason: "INFORMED_LEAVE", note: `Long leave: ${reason}`, markedBy: user.name },
    });
  }

  await audit(user.id, "employee.longLeave", "Employee", employeeId, {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days,
    reason,
  });

  // Straight to Jagdish and the owner.
  try {
    const { sendWhatsApp, whatsappConfigured } = await import("@/lib/whatsapp");
    const text =
      `🏖 Long leave recorded\n\n` +
      `Worker: ${employee.name} (${employee.code}, ${employee.skill})\n` +
      `Unit: ${employee.primaryUnit.name}\n` +
      `From: ${formatDate(from)}\n` +
      `To: ${formatDate(to)} (${days} day${days === 1 ? "" : "s"})\n` +
      `Reason: ${reason}\n` +
      `Recorded by: ${user.name}`;
    if (whatsappConfigured()) {
      await sendWhatsApp(text);
    } else {
      const { sendOwnerEmail } = await import("@/lib/email");
      await sendOwnerEmail(
        `🏖 ${employee.name} on leave ${formatDate(from)} → ${formatDate(to)} (${days}d)`,
        `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
           <h2 style="margin-bottom:4px">🏖 Long leave recorded</h2>
           <p style="white-space:pre-line;margin:0">${text.split("\n").slice(2).join("\n")}</p>
         </div>`
      );
    }
  } catch (err) {
    console.error("leave alert failed:", err);
  }

  void period;
  revalidatePath("/employees");
  revalidatePath("/");
}

// Cancel a recorded holiday — clears its future leave days too.
export async function cancelLongLeave(formData: FormData) {
  const user = await requireUser();
  const periodId = String(formData.get("periodId") ?? "");
  const period = await db.leavePeriod.findUniqueOrThrow({
    where: { id: periodId },
    include: { employee: { select: { primaryUnitId: true } } },
  });
  assertUnitAccess(user, period.employee.primaryUnitId);
  if (!isAdmin(user) && period.markedById !== user.id) {
    throw new Error("Only the person who recorded it, or an admin, can cancel this leave.");
  }
  await db.leaveDay.deleteMany({
    where: {
      employeeId: period.employeeId,
      date: { gte: period.fromDate, lte: period.toDate },
    },
  });
  await db.leavePeriod.delete({ where: { id: periodId } });
  await audit(user.id, "employee.longLeaveCancel", "Employee", period.employeeId, { periodId });
  revalidatePath("/employees");
  revalidatePath("/");
}
