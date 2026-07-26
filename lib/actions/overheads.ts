"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/permissions";
import { istToday } from "@/lib/overheads";

// Fixed monthly overheads — owner only.

export async function addOverheadItem(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const monthlyAmount = Number(String(formData.get("monthlyAmount") ?? "").trim());
  const unitId = String(formData.get("unitId") ?? "") || null;
  const fromRaw = String(formData.get("effectiveFrom") ?? "");
  const effectiveFrom = fromRaw ? new Date(fromRaw) : istToday();
  if (!name || isNaN(monthlyAmount) || monthlyAmount <= 0 || monthlyAmount > 100000000) return;
  if (isNaN(effectiveFrom.getTime())) return;

  const item = await db.overheadItem.create({
    data: { name, monthlyAmount, unitId, effectiveFrom },
  });
  await audit(user.id, "overhead.add", "OverheadItem", item.id, {
    name,
    monthlyAmount,
    unitId,
    effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
  });
  revalidatePath("/overheads");
}

// Stop from today onward — past days keep their cost. Use this when rent or
// a bill changes: stop the old item and add a new one.
export async function stopOverheadItem(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const itemId = String(formData.get("itemId") ?? "");
  await db.overheadItem.update({ where: { id: itemId }, data: { endedAt: istToday() } });
  await audit(user.id, "overhead.stop", "OverheadItem", itemId);
  revalidatePath("/overheads");
}

// Delete entirely — removes its cost from history too. For entry mistakes.
export async function deleteOverheadItem(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const itemId = String(formData.get("itemId") ?? "");
  const item = await db.overheadItem.findUniqueOrThrow({ where: { id: itemId } });
  await db.overheadItem.delete({ where: { id: itemId } });
  await audit(user.id, "overhead.delete", "OverheadItem", itemId, { name: item.name });
  revalidatePath("/overheads");
}
