"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";
import { syncJobToCalendar, deleteCalendarEvent } from "@/lib/google-calendar";
import { readUploadedFiles, type PendingAttachment } from "@/lib/attachments";
import type { JobStatus } from "@prisma/client";
import type { FormState } from "./auth";

// Job creation (spec §4): client/buyer/PO/unit/description, template or
// custom stages, mandatory expected completion date, optional save-as-template.
export async function createJob(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Only admins can create jobs." };

  const clientName = String(formData.get("clientName") ?? "").trim();
  const buyerName = String(formData.get("buyerName") ?? "").trim() || null;
  const poNumber = String(formData.get("poNumber") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim();
  const unitId = String(formData.get("unitId") ?? "");
  const expectedCompletionRaw = String(formData.get("expectedCompletion") ?? "");
  const reminderDaysBefore = Number(formData.get("reminderDaysBefore") ?? 7);
  const priority = formData.get("priority") === "on";
  const templateId = String(formData.get("templateId") ?? "") || null;
  const customStagesRaw = String(formData.get("customStages") ?? "");
  const saveAsTemplate = String(formData.get("saveAsTemplate") ?? "").trim();

  if (!clientName || !description || !unitId) {
    return { error: "Client name, description and unit are required." };
  }
  if (!expectedCompletionRaw) {
    return { error: "Expected completion date is mandatory." };
  }
  try {
    assertUnitAccess(user, unitId);
  } catch {
    return { error: "You do not have access to that unit." };
  }
  const expectedCompletion = new Date(expectedCompletionRaw);
  if (isNaN(expectedCompletion.getTime())) {
    return { error: "Expected completion date is invalid." };
  }

  // Resolve the stage list: template or custom (one stage name per line).
  let stages: { name: string; description: string | null }[] = [];
  if (templateId) {
    const template = await db.jobTemplate.findUnique({
      where: { id: templateId },
      include: { stages: { orderBy: { sequence: "asc" } } },
    });
    if (!template) return { error: "Selected template not found." };
    stages = template.stages.map((s) => ({ name: s.name, description: s.description }));
  } else {
    stages = customStagesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ name, description: null }));
  }
  if (stages.length === 0) {
    return { error: "Pick a template or enter at least one custom stage." };
  }

  // Drawings & bill of material, validated and buffered before anything is
  // written to the database.
  let attachments: PendingAttachment[];
  try {
    attachments = [
      ...(await readUploadedFiles(formData.getAll("drawings"), "DRAWING")),
      ...(await readUploadedFiles(formData.getAll("bomFiles"), "BOM")),
    ];
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const job = await db.$transaction(async (tx) => {
    let usedTemplateId = templateId;

    if (!templateId && saveAsTemplate) {
      const existing = await tx.jobTemplate.findUnique({ where: { name: saveAsTemplate } });
      if (existing) throw new Error(`A template named "${saveAsTemplate}" already exists.`);
      const newTemplate = await tx.jobTemplate.create({
        data: {
          name: saveAsTemplate,
          stages: {
            create: stages.map((s, i) => ({ ...s, sequence: i + 1 })),
          },
        },
      });
      usedTemplateId = newTemplate.id;
      await audit(user.id, "template.create", "JobTemplate", newTemplate.id, { name: saveAsTemplate }, tx);
    }

    const created = await tx.job.create({
      data: {
        clientName,
        buyerName,
        poNumber,
        description,
        unitId,
        expectedCompletion,
        reminderDaysBefore: isNaN(reminderDaysBefore) ? 7 : reminderDaysBefore,
        priority,
        templateId: usedTemplateId,
        createdById: user.id,
        stages: {
          create: stages.map((s, i) => ({ ...s, sequence: i + 1 })),
        },
      },
    });
    if (attachments.length > 0) {
      await tx.jobAttachment.createMany({
        data: attachments.map((a) => ({
          ...a,
          jobId: created.id,
          uploadedById: user.id,
        })),
      });
    }
    await audit(user.id, "job.create", "Job", created.id, {
      clientName,
      unitId,
      attachments: attachments.map((a) => a.filename),
    }, tx);
    return created;
  }).catch((err: Error) => ({ error: err.message }));

  if ("error" in job) return { error: job.error };
  await syncJobToCalendar(job.id); // best-effort; never blocks job creation
  revalidatePath("/");
  revalidatePath("/jobs");
  redirect(`/jobs/${job.id}`);
}

export async function updateJob(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Only admins can edit jobs." };
  const jobId = String(formData.get("jobId") ?? "");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);

  const clientName = String(formData.get("clientName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const expectedCompletionRaw = String(formData.get("expectedCompletion") ?? "");
  if (!clientName || !description || !expectedCompletionRaw) {
    return { error: "Client, description and expected completion are required." };
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      clientName,
      buyerName: String(formData.get("buyerName") ?? "").trim() || null,
      poNumber: String(formData.get("poNumber") ?? "").trim() || null,
      description,
      expectedCompletion: new Date(expectedCompletionRaw),
      reminderDaysBefore: Number(formData.get("reminderDaysBefore") ?? 7) || 7,
      priority: formData.get("priority") === "on",
    },
  });
  await audit(user.id, "job.update", "Job", jobId);
  await syncJobToCalendar(jobId); // date/reminder may have changed
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return undefined;
}

export async function setJobStatus(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const status = String(formData.get("status") ?? "") as JobStatus;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  // Supervisors may move jobs between In Progress / On Hold; only admins may
  // complete or reset a job.
  if (!isAdmin(user) && (status === "COMPLETED" || status === "NOT_STARTED")) {
    throw new Error("Only admins can complete or reset a job.");
  }

  await db.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { status } });
    if (status === "COMPLETED") {
      // Close any still-open time logs on this job.
      const open = await tx.timeLog.findMany({ where: { jobId, endedAt: null } });
      for (const log of open) {
        await tx.timeLog.update({
          where: { id: log.id },
          data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
        });
      }
    }
    await audit(user.id, "job.status", "Job", jobId, { status }, tx);
  });
  await syncJobToCalendar(jobId); // completing a job removes its calendar event
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/");
}

export async function deleteJob(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") throw new Error("Only the superadmin can delete jobs.");
  const jobId = String(formData.get("jobId") ?? "");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  await db.job.delete({ where: { id: jobId } });
  await audit(user.id, "job.delete", "Job", jobId);
  if (job.googleEventId) await deleteCalendarEvent(job.googleEventId, jobId);
  revalidatePath("/jobs");
  revalidatePath("/");
  redirect("/jobs");
}
