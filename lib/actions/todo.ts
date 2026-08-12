"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, requireRole, isAdmin, assertUnitAccess } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// The morning To-Do list: owner-added items plus quick-fix actions for the
// auto-detected reminders (PO number, dispatch date, drawing reuse).
// ---------------------------------------------------------------------------

export async function addOwnerTodo(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const message = String(formData.get("message") ?? "").trim();
  const unitId = String(formData.get("unitId") ?? "") || null;
  const jobId = String(formData.get("jobId") ?? "") || null;
  if (!message) return;
  const item = await db.todoItem.create({
    data: { message, unitId, jobId, createdById: user.id },
  });
  await audit(user.id, "todo.add", "TodoItem", item.id, { message, unitId, jobId });
  revalidatePath("/todo");
}

export async function toggleTodoDone(formData: FormData) {
  const user = await requireUser();
  const itemId = String(formData.get("itemId") ?? "");
  const item = await db.todoItem.findUniqueOrThrow({ where: { id: itemId } });
  if (item.unitId) assertUnitAccess(user, item.unitId);
  await db.todoItem.update({
    where: { id: itemId },
    data: item.done
      ? { done: false, doneBy: null, doneAt: null }
      : { done: true, doneBy: user.name, doneAt: new Date() },
  });
  await audit(user.id, item.done ? "todo.undo" : "todo.done", "TodoItem", itemId);
  revalidatePath("/todo");
}

export async function deleteOwnerTodo(formData: FormData) {
  const user = await requireRole("SUPERADMIN");
  const itemId = String(formData.get("itemId") ?? "");
  await db.todoItem.delete({ where: { id: itemId } });
  await audit(user.id, "todo.delete", "TodoItem", itemId);
  revalidatePath("/todo");
}

// PO number + PO value (without GST) — supervisors fill them when missing;
// admins can correct.
export async function setJobPoNumber(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const poNumber = String(formData.get("poNumber") ?? "").trim();
  const poValue = Number(String(formData.get("poValue") ?? "").trim());
  if (!poNumber || isNaN(poValue) || poValue <= 0) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  const alreadySet = Boolean(job.poNumber && job.poNumber.trim() && job.poValue);
  if (alreadySet && !isAdmin(user)) {
    throw new Error("PO details are already set — only admins can change them.");
  }
  // Entering the PO clears any "not received yet" marker.
  await db.job.update({
    where: { id: jobId },
    data: { poNumber, poValue, poAwaited: false, poAwaitedAt: null, poExpectedBy: null },
  });
  await audit(user.id, "job.poNumber", "Job", jobId, { poNumber, poValue });
  revalidatePath("/todo");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

// "The customer hasn't sent the PO yet." Pauses the daily reminder; the job
// is chased again once the expected date passes (or after two weeks if no
// date was given), so nothing is quietly forgotten.
export async function markPoAwaited(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const expectedRaw = String(formData.get("poExpectedBy") ?? "").trim();
  const expected = expectedRaw ? new Date(expectedRaw) : null;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  await db.job.update({
    where: { id: jobId },
    data: {
      poAwaited: true,
      poAwaitedAt: job.poAwaitedAt ?? new Date(),
      poExpectedBy: expected && !isNaN(expected.getTime()) ? expected : null,
    },
  });
  await audit(user.id, "job.poAwaited", "Job", jobId, { poExpectedBy: expected });
  revalidatePath("/todo");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

// Planned dispatch date, asked in the morning list — write-once for
// supervisors; admins can change it later.
export async function setJobEstimatedDispatch(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const raw = String(formData.get("estimatedDispatch") ?? "");
  const when = new Date(raw);
  if (!raw || isNaN(when.getTime())) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (job.estimatedDispatchAt && !isAdmin(user)) {
    throw new Error("Dispatch date is already set — only admins can change it.");
  }
  await db.job.update({ where: { id: jobId }, data: { estimatedDispatchAt: when } });
  await audit(user.id, "job.estimatedDispatch", "Job", jobId, { estimatedDispatchAt: raw });
  revalidatePath("/todo");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}

// Drawings are usually identical for the same job name — copy them across
// after the supervisor confirms.
export async function copyDrawings(formData: FormData) {
  const user = await requireUser();
  const fromJobId = String(formData.get("fromJobId") ?? "");
  const toJobId = String(formData.get("toJobId") ?? "");
  const [from, to] = await Promise.all([
    db.job.findUniqueOrThrow({ where: { id: fromJobId } }),
    db.job.findUniqueOrThrow({ where: { id: toJobId } }),
  ]);
  assertUnitAccess(user, to.unitId);
  const drawings = await db.jobAttachment.findMany({
    where: { jobId: fromJobId, kind: "DRAWING" },
    select: { id: true, filename: true },
  });
  if (drawings.length === 0) return;
  // Copy inside Postgres — the drawing bytes never travel to the app server.
  await db.$executeRaw`
    INSERT INTO "JobAttachment"
      ("id", "jobId", "kind", "filename", "mimeType", "size", "data", "uploadedById")
    SELECT gen_random_uuid()::text, ${toJobId}, "kind", "filename", "mimeType", "size", "data", ${user.id}
    FROM "JobAttachment"
    WHERE "jobId" = ${fromJobId} AND "kind" = 'DRAWING'::"AttachmentKind"`;
  await audit(user.id, "job.copyDrawings", "Job", toJobId, {
    fromJobId,
    files: drawings.map((d) => d.filename),
  });
  revalidatePath("/todo");
  revalidatePath(`/jobs/${toJobId}`);
}
