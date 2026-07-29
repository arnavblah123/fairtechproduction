"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, requireRole, isAdmin, assertUnitAccess } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Production planning (any date range). Plans and targets are superadmin-only to
// write; everyone can view. Supervisors contribute by adding future jobs to
// the backlog.
// ---------------------------------------------------------------------------

export async function createPlan(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const unitId = String(formData.get("unitId") ?? "") || null;
  const startRaw = String(formData.get("startDate") ?? "");
  const endRaw = String(formData.get("endDate") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const startDate = startRaw ? new Date(startRaw) : new Date();
  const endDate = endRaw
    ? new Date(endRaw)
    : new Date(startDate.getTime() + 9 * 86400000);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) return;

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const name = String(formData.get("name") ?? "").trim() || `Plan ${fmt(startDate)} – ${fmt(endDate)}`;

  const plan = await db.plan.create({
    data: { name, unitId, startDate, endDate, notes, createdById: user.id },
  });
  await audit(user.id, "plan.create", "Plan", plan.id, { name });
  revalidatePath("/planning");
}

export async function deletePlan(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const planId = String(formData.get("planId") ?? "");
  await db.plan.delete({ where: { id: planId } });
  await audit(user.id, "plan.delete", "Plan", planId);
  revalidatePath("/planning");
}

export async function addPlanItem(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const planId = String(formData.get("planId") ?? "");
  const jobId = String(formData.get("jobId") ?? "") || null;
  const stageRaw = String(formData.get("stageId") ?? "");
  // "dispatch" is a sentinel: the target is the job's dispatch itself,
  // auto-ticked when the job is marked Dispatched.
  const isDispatch = stageRaw === "dispatch";
  const stageId = isDispatch ? null : stageRaw || null;
  let description = String(formData.get("description") ?? "").trim();
  const targetRaw = String(formData.get("targetDate") ?? "");
  const targetDate = targetRaw ? new Date(targetRaw) : null;
  if (!targetDate || isNaN(targetDate.getTime())) return;
  if (isDispatch && !jobId) return;

  if (stageId) {
    const stage = await db.stage.findUniqueOrThrow({ where: { id: stageId } });
    if (jobId && stage.jobId !== jobId) return;
    if (!description) description = stage.name;
  }
  if (isDispatch && !description) description = "🚚 Dispatch";
  if (!description) return;

  const item = await db.planItem.create({
    data: { planId, jobId, stageId, description, targetDate, isDispatch },
  });
  await audit(user.id, "plan.itemAdd", "PlanItem", item.id, {
    planId,
    jobId,
    stageId,
    isDispatch,
    description,
    targetDate: targetDate.toISOString(),
  });
  revalidatePath("/planning");
}

export async function deletePlanItem(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const itemId = String(formData.get("itemId") ?? "");
  await db.planItem.delete({ where: { id: itemId } });
  await audit(user.id, "plan.itemDelete", "PlanItem", itemId);
  revalidatePath("/planning");
}

// Manual tick for free-text targets (stage-linked ones auto-complete).
export async function togglePlanItemDone(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const itemId = String(formData.get("itemId") ?? "");
  const item = await db.planItem.findUniqueOrThrow({ where: { id: itemId } });
  await db.planItem.update({
    where: { id: itemId },
    data: { done: !item.done, doneAt: item.done ? null : new Date() },
  });
  await audit(user.id, "plan.itemToggle", "PlanItem", itemId, { done: !item.done });
  revalidatePath("/planning");
}

// A late target needs an explanation — supervisors state why. Write-once
// for supervisors; admins/owner can correct it later.
export async function setPlanItemLateReason(formData: FormData) {
  const user = await requireUser();
  const itemId = String(formData.get("itemId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  const item = await db.planItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { plan: { select: { unitId: true } } },
  });
  if (item.plan.unitId) assertUnitAccess(user, item.plan.unitId);
  if (item.lateReason && !isAdmin(user)) {
    throw new Error("A reason is already recorded — only admins can change it.");
  }
  await db.planItem.update({
    where: { id: itemId },
    data: { lateReason: reason, lateReasonBy: user.name, lateReasonAt: new Date() },
  });
  await audit(user.id, "plan.lateReason", "PlanItem", itemId, { reason });
  revalidatePath("/planning");
}

// Backlog of upcoming work — supervisors and admins can add.
export async function addFutureJob(formData: FormData) {
  const user = await requireUser();
  const clientName = String(formData.get("clientName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const unitId = String(formData.get("unitId") ?? "") || null;
  const startRaw = String(formData.get("expectedStart") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!clientName || !description) return;

  const entry = await db.futureJob.create({
    data: {
      clientName,
      description,
      unitId,
      expectedStart: startRaw ? new Date(startRaw) : null,
      notes,
      addedById: user.id,
    },
  });
  await audit(user.id, "futureJob.add", "FutureJob", entry.id, { clientName, description });
  revalidatePath("/planning");
}

export async function deleteFutureJob(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Only admins can remove backlog entries.");
  const id = String(formData.get("futureJobId") ?? "");
  const entry = await db.futureJob.findUniqueOrThrow({ where: { id } });
  await db.futureJob.delete({ where: { id } });
  await audit(user.id, "futureJob.delete", "FutureJob", id, { clientName: entry.clientName });
  revalidatePath("/planning");
}
