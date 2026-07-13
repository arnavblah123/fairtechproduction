"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";
import { readUploadedFiles } from "@/lib/attachments";
import type { AttachmentKind } from "@prisma/client";
import type { FormState } from "./auth";

// Add drawings/BOM to an existing job (admins only).
export async function addAttachments(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Only admins can upload documents." };
  const jobId = String(formData.get("jobId") ?? "");
  const kind = String(formData.get("kind") ?? "OTHER") as AttachmentKind;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);

  let rows;
  try {
    rows = await readUploadedFiles(formData.getAll("files"), kind);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (rows.length === 0) return { error: "Choose at least one file." };

  await db.jobAttachment.createMany({
    data: rows.map((a) => ({ ...a, jobId, uploadedById: user.id })),
  });
  await audit(user.id, "attachment.add", "Job", jobId, {
    kind,
    files: rows.map((a) => a.filename),
  });
  revalidatePath(`/jobs/${jobId}`);
  return undefined;
}

export async function deleteAttachment(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Only admins can delete documents.");
  const attachmentId = String(formData.get("attachmentId") ?? "");
  const attachment = await db.jobAttachment.findUniqueOrThrow({
    where: { id: attachmentId },
    include: { job: true },
  });
  assertUnitAccess(user, attachment.job.unitId);
  await db.jobAttachment.delete({ where: { id: attachmentId } });
  await audit(user.id, "attachment.delete", "Job", attachment.jobId, {
    filename: attachment.filename,
  });
  revalidatePath(`/jobs/${attachment.jobId}`);
}
