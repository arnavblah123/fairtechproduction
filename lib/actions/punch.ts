"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";
import { istToday } from "@/lib/overheads";

// Daily punch-in for supervisors/admins: "I'm at unit X today." Re-punching
// the same day just moves the day to another unit.
export async function punchInDay(formData: FormData) {
  const user = await requireUser();
  if (user.role === "SUPERADMIN") return; // the owner doesn't punch
  const unitId = String(formData.get("unitId") ?? "");
  assertUnitAccess(user, unitId);
  const date = istToday();
  await db.supervisorDay.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, unitId, date },
    update: { unitId },
  });
  await audit(user.id, "day.punchIn", "SupervisorDay", user.id, {
    unitId,
    date: date.toISOString().slice(0, 10),
  });
  revalidatePath("/");
}
