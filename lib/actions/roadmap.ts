"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/permissions";

// Manufacturing road map planning. Same rule as the rest of planning: only
// the owner sets the plan; everyone else reads it.
async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") throw new Error("Only the owner can change the road map.");
  return user;
}

function parseDate(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Planned bar (and optional cell note like "NA") for one activity row.
export async function setStagePlan(formData: FormData) {
  const user = await requireOwner();
  const stageId = String(formData.get("stageId") ?? "");
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    select: { id: true, jobId: true, name: true },
  });
  const plannedStart = parseDate(formData.get("plannedStart"));
  const plannedEnd = parseDate(formData.get("plannedEnd"));
  const roadmapNote = String(formData.get("roadmapNote") ?? "").trim().slice(0, 20) || null;

  await db.stage.update({
    where: { id: stageId },
    data: {
      plannedStart,
      // A one-day activity can be entered with only a start date.
      plannedEnd: plannedEnd ?? plannedStart,
      roadmapNote,
    },
  });
  await audit(user.id, "roadmap.setPlan", "Stage", stageId, {
    plannedStart,
    plannedEnd: plannedEnd ?? plannedStart,
    roadmapNote,
  });
  revalidatePath(`/roadmap`);
  revalidatePath(`/jobs/${stage.jobId}`);
}

// Who should work on this activity — replaces the whole list for the stage.
export async function setStageWorkers(formData: FormData) {
  const user = await requireOwner();
  const stageId = String(formData.get("stageId") ?? "");
  const employeeIds = [...new Set(formData.getAll("employeeIds").map(String).filter(Boolean))];
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    select: { id: true, jobId: true },
  });

  await db.$transaction(async (tx) => {
    await tx.stagePlanWorker.deleteMany({ where: { stageId } });
    if (employeeIds.length > 0) {
      await tx.stagePlanWorker.createMany({
        data: employeeIds.map((employeeId) => ({ stageId, employeeId })),
        skipDuplicates: true,
      });
    }
  });
  await audit(user.id, "roadmap.setWorkers", "Stage", stageId, { employeeIds });
  revalidatePath(`/roadmap`);
  revalidatePath(`/jobs/${stage.jobId}`);
}

// Quick "add one worker" used by the row's picker, so the owner can build the
// team up one tap at a time on a phone.
export async function addStageWorker(formData: FormData) {
  const user = await requireOwner();
  const stageId = String(formData.get("stageId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return;
  await db.stagePlanWorker.upsert({
    where: { stageId_employeeId: { stageId, employeeId } },
    create: { stageId, employeeId },
    update: {},
  });
  await audit(user.id, "roadmap.addWorker", "Stage", stageId, { employeeId });
  revalidatePath(`/roadmap`);
}

export async function removeStageWorker(formData: FormData) {
  const user = await requireOwner();
  const stageId = String(formData.get("stageId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  await db.stagePlanWorker.deleteMany({ where: { stageId, employeeId } });
  await audit(user.id, "roadmap.removeWorker", "Stage", stageId, { employeeId });
  revalidatePath(`/roadmap`);
}
