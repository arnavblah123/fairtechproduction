"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";
import { readUploadedFiles } from "@/lib/attachments";
import { jobCode } from "@/lib/format";
import type { AttachmentKind } from "@prisma/client";
import type { FormState } from "./auth";

// A drawing is always stored under the name of the job it was uploaded for,
// so when it is later reused on another job everyone can still see which job
// it was drawn for.
function jobStamp(job: { jobNumber: number; description: string }): string {
  return `${jobCode(job.jobNumber)} ${job.description}`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

// Add drawings/BOM to an existing job. Supervisors upload for their own
// units — they are the ones the morning list asks for drawings; deleting
// stays with admins.
export async function addAttachments(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const kind = String(formData.get("kind") ?? "OTHER") as AttachmentKind;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  try {
    assertUnitAccess(user, job.unitId);
  } catch {
    return { error: "You do not have access to this job's unit." };
  }

  let rows;
  try {
    rows = await readUploadedFiles(formData.getAll("files"), kind);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (rows.length === 0) return { error: "Choose at least one file." };

  const stamp = jobStamp(job);
  await db.jobAttachment.createMany({
    data: rows.map((a) => ({
      ...a,
      // Name it after this job, unless it already carries the stamp.
      filename: a.filename.startsWith(stamp) ? a.filename : `${stamp} — ${a.filename}`,
      jobId,
      uploadedById: user.id,
    })),
  });
  // A real drawing arriving clears any "drawing may have changed" flag and
  // ticks off the reminder that was chasing it.
  if (kind === "DRAWING") {
    await db.job.update({ where: { id: jobId }, data: { drawingPending: false } });
    await db.todoItem.updateMany({
      where: { jobId, done: false, message: { startsWith: "Upload updated drawing" } },
      data: { done: true, doneBy: user.name, doneAt: new Date() },
    });
  }
  await audit(user.id, "attachment.add", "Job", jobId, {
    kind,
    files: rows.map((a) => a.filename),
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/todo");
  return undefined;
}

export async function deleteAttachment(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Only admins can delete documents.");
  const attachmentId = String(formData.get("attachmentId") ?? "");
  // Explicit select — never drag the file bytes into Node just to delete a row.
  const attachment = await db.jobAttachment.findUniqueOrThrow({
    where: { id: attachmentId },
    select: {
      jobId: true,
      futureJobId: true,
      filename: true,
      job: { select: { unitId: true } },
      futureJob: { select: { unitId: true } },
    },
  });
  // A document hangs off a job or off an order in the order book. An order
  // with no unit decided yet is the owner's alone.
  const unitId = attachment.job?.unitId ?? attachment.futureJob?.unitId ?? null;
  if (unitId === null) {
    if (user.role !== "SUPERADMIN") {
      throw new Error("You do not have access to this document.");
    }
  } else {
    assertUnitAccess(user, unitId);
  }
  await db.jobAttachment.delete({ where: { id: attachmentId } });
  await audit(
    user.id,
    "attachment.delete",
    attachment.jobId ? "Job" : "FutureJob",
    attachment.jobId ?? attachment.futureJobId ?? attachmentId,
    { filename: attachment.filename }
  );
  if (attachment.jobId) revalidatePath(`/jobs/${attachment.jobId}`);
  else revalidatePath("/order-book");
}
