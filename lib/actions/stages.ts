"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";
import type { StageStatus } from "@prisma/client";

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/");
}

// Start / pause / complete / reopen a stage. Reopening after Done is allowed
// (spec: supervisors shift people back).
export async function setStageStatus(formData: FormData) {
  const user = await requireUser();
  const stageId = String(formData.get("stageId") ?? "");
  const status = String(formData.get("status") ?? "") as StageStatus;
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { job: true },
  });
  assertUnitAccess(user, stage.job.unitId);

  await db.$transaction(async (tx) => {
    await tx.stage.update({
      where: { id: stageId },
      data: {
        status,
        startedAt: status === "ACTIVE" && !stage.startedAt ? new Date() : stage.startedAt,
        completedAt: status === "DONE" ? new Date() : null,
      },
    });

    // Pausing or finishing a stage stops the clock for everyone on it.
    if (status === "PAUSED" || status === "DONE" || status === "PENDING") {
      const open = await tx.timeLog.findMany({ where: { stageId, endedAt: null } });
      for (const log of open) {
        await tx.timeLog.update({
          where: { id: log.id },
          data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
        });
      }
    }

    // First stage starting moves the job to In Progress.
    if (status === "ACTIVE" && stage.job.status === "NOT_STARTED") {
      await tx.job.update({ where: { id: stage.jobId }, data: { status: "IN_PROGRESS" } });
      await audit(user.id, "job.status", "Job", stage.jobId, { status: "IN_PROGRESS", trigger: "first stage started" }, tx);
    }

    await audit(user.id, "stage.status", "Stage", stageId, { status, jobId: stage.jobId }, tx);
  });
  revalidateJob(stage.jobId);
}

// Assign a worker to a stage. Any open log the worker has elsewhere is closed
// first (a worker can only be clocked on one stage at a time — reassignment
// mid-stage is exactly this).
export async function assignWorker(formData: FormData) {
  const user = await requireUser();
  const stageId = String(formData.get("stageId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return;
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { job: true },
  });
  assertUnitAccess(user, stage.job.unitId);
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

  await db.$transaction(async (tx) => {
    const open = await tx.timeLog.findMany({
      where: { employeeId, endedAt: null },
    });
    if (open.some((l) => l.stageId === stageId)) return; // already on this stage
    for (const log of open) {
      await tx.timeLog.update({
        where: { id: log.id },
        data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
      });
      await audit(user.id, "timelog.stop", "TimeLog", log.id, { reason: "reassigned", toStageId: stageId }, tx);
    }

    const newLog = await tx.timeLog.create({
      data: {
        employeeId,
        jobId: stage.jobId,
        stageId,
        unitId: stage.job.unitId,
        startSource: "MANUAL",
        startedById: user.id,
      },
    });

    // Assigning to a pending/paused stage activates it.
    if (stage.status === "PENDING" || stage.status === "PAUSED") {
      await tx.stage.update({
        where: { id: stageId },
        data: { status: "ACTIVE", startedAt: stage.startedAt ?? new Date() },
      });
      if (stage.job.status === "NOT_STARTED") {
        await tx.job.update({ where: { id: stage.jobId }, data: { status: "IN_PROGRESS" } });
      }
    }

    await audit(user.id, "timelog.assign", "TimeLog", newLog.id, {
      employeeId,
      employeeCode: employee.code,
      stageId,
      jobId: stage.jobId,
    }, tx);
  });
  revalidateJob(stage.jobId);
  revalidatePath("/employees");
}

// Stop one worker's clock on a stage without touching the stage status.
export async function stopWorker(formData: FormData) {
  const user = await requireUser();
  const timeLogId = String(formData.get("timeLogId") ?? "");
  const log = await db.timeLog.findUniqueOrThrow({
    where: { id: timeLogId },
    include: { job: true },
  });
  assertUnitAccess(user, log.job.unitId);
  if (log.endedAt) return;
  await db.timeLog.update({
    where: { id: timeLogId },
    data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
  });
  await audit(user.id, "timelog.stop", "TimeLog", timeLogId, { reason: "manual stop" });
  revalidateJob(log.jobId);
  revalidatePath("/employees");
}

// Record rework on a stage. The reason is mandatory; recording rework on a
// Done stage reopens it (this replaces the old bare "Reopen" button, so a
// reason is always captured).
export async function recordRework(formData: FormData) {
  const user = await requireUser();
  const stageId = String(formData.get("stageId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { job: true },
  });
  assertUnitAccess(user, stage.job.unitId);
  if (stage.job.status === "COMPLETED") return;

  await db.$transaction(async (tx) => {
    const rework = await tx.stageRework.create({
      data: { stageId, jobId: stage.jobId, reason, raisedById: user.id },
    });
    if (stage.status === "DONE") {
      await tx.stage.update({
        where: { id: stageId },
        data: { status: "ACTIVE", completedAt: null },
      });
      if (stage.job.status === "NOT_STARTED") {
        await tx.job.update({ where: { id: stage.jobId }, data: { status: "IN_PROGRESS" } });
      }
    }
    await audit(user.id, "stage.rework", "Stage", stageId, {
      jobId: stage.jobId,
      reworkId: rework.id,
      reason,
      reopened: stage.status === "DONE",
    }, tx);
  });
  revalidateJob(stage.jobId);
}

// Admins can append an extra stage to a job in progress.
export async function addStage(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { stages: { orderBy: { sequence: "desc" }, take: 1 } },
  });
  assertUnitAccess(user, job.unitId);
  const nextSeq = (job.stages[0]?.sequence ?? 0) + 1;
  const stage = await db.stage.create({
    data: { jobId, name, sequence: nextSeq },
  });
  await audit(user.id, "stage.create", "Stage", stage.id, { jobId, name });
  revalidateJob(jobId);
}
