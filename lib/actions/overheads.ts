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
  const period = String(formData.get("period") ?? "MONTHLY") === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  // Any subset of units; none ticked = all units.
  const unitIds = formData.getAll("unitIds").map(String).filter(Boolean);
  const fromRaw = String(formData.get("effectiveFrom") ?? "");
  const effectiveFrom = fromRaw ? new Date(fromRaw) : istToday();
  if (!name || isNaN(monthlyAmount) || monthlyAmount <= 0 || monthlyAmount > 1000000000) return;
  if (isNaN(effectiveFrom.getTime())) return;

  const item = await db.overheadItem.create({
    data: {
      name,
      monthlyAmount,
      period,
      effectiveFrom,
      units: { create: unitIds.map((unitId) => ({ unitId })) },
    },
  });
  await audit(user.id, "overhead.add", "OverheadItem", item.id, {
    name,
    monthlyAmount,
    period,
    unitIds,
    effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
  });
  revalidatePath("/overheads");
}

// Edit name / amount / period in place. Changes the rate for ALL days the
// item covers (past included) — for a rate change that should keep history,
// Stop the old item and Add a new one instead.
export async function updateOverheadItem(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const itemId = String(formData.get("itemId") ?? "");
  const monthlyAmount = Number(String(formData.get("monthlyAmount") ?? "").trim());
  const period = String(formData.get("period") ?? "MONTHLY") === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const name = String(formData.get("name") ?? "").trim();
  if (isNaN(monthlyAmount) || monthlyAmount <= 0 || monthlyAmount > 1000000000) return;
  const item = await db.overheadItem.findUniqueOrThrow({ where: { id: itemId } });
  await db.overheadItem.update({
    where: { id: itemId },
    data: { monthlyAmount, period, ...(name ? { name } : {}) },
  });
  await audit(user.id, "overhead.edit", "OverheadItem", itemId, {
    name: name || item.name,
    monthlyAmount,
    period,
  });
  revalidatePath("/overheads");
  // Editable straight from a job page too — refresh that page's numbers.
  const also = String(formData.get("alsoRevalidate") ?? "");
  if (also.startsWith("/")) revalidatePath(also);
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
