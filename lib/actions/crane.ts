"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";

// Start the clock when an outside crane is called for material handling or
// dispatch. The hours verify the crane vendor's bill.
export async function startCrane(formData: FormData) {
  const user = await requireUser();
  const unitId = String(formData.get("unitId") ?? "");
  const purpose = String(formData.get("purpose") ?? "") as "MATERIAL_HANDLING" | "DISPATCH";
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!["MATERIAL_HANDLING", "DISPATCH"].includes(purpose)) return;
  assertUnitAccess(user, unitId);

  const log = await db.craneLog.create({
    data: { unitId, purpose, note, startedById: user.id },
  });
  await audit(user.id, "crane.start", "CraneLog", log.id, { unitId, purpose, note });
  revalidatePath("/");
}

export async function stopCrane(formData: FormData) {
  const user = await requireUser();
  const craneLogId = String(formData.get("craneLogId") ?? "");
  const log = await db.craneLog.findUniqueOrThrow({ where: { id: craneLogId } });
  assertUnitAccess(user, log.unitId);
  if (log.endedAt) return;
  await db.craneLog.update({
    where: { id: craneLogId },
    data: { endedAt: new Date(), endedById: user.id },
  });
  await audit(user.id, "crane.stop", "CraneLog", craneLogId, { unitId: log.unitId });
  revalidatePath("/");
}
