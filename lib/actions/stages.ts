"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess, isAdmin } from "@/lib/permissions";
import type { StageStatus } from "@prisma/client";

function revalidateJob(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/");
}

// Start / pause / resume a stage. Completing goes through completeStage()
// so the quality-check inspector is always recorded.
export async function setStageStatus(formData: FormData) {
  const user = await requireUser();
  const stageId = String(formData.get("stageId") ?? "");
  const status = String(formData.get("status") ?? "") as StageStatus;
  if (status === "DONE") {
    throw new Error("Completing a stage requires the inspector's name.");
  }
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { job: true },
  });
  assertUnitAccess(user, stage.job.unitId);

  // Optional task due date, offered when starting a stage. Write-once for
  // supervisors: once a due date exists, only admins can change it.
  const dueRaw = String(formData.get("dueAt") ?? "");
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  const mayWriteDue =
    dueAt && !isNaN(dueAt.getTime()) && (stage.dueAt === null || isAdmin(user));

  const stoppedEmployeeIds: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.stage.update({
      where: { id: stageId },
      data: {
        status,
        startedAt: status === "ACTIVE" && !stage.startedAt ? new Date() : stage.startedAt,
        completedAt: null,
        ...(mayWriteDue ? { dueAt } : {}),
      },
    });

    // Pausing or resetting a stage stops the clock for everyone on it.
    if (status === "PAUSED" || status === "PENDING") {
      const open = await tx.timeLog.findMany({ where: { stageId, endedAt: null } });
      for (const log of open) {
        await tx.timeLog.update({
          where: { id: log.id },
          data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
        });
        stoppedEmployeeIds.push(log.employeeId);
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
  // Pausing freed up workers — ask where they're going now.
  if (status === "PAUSED" && stoppedEmployeeIds.length > 0) {
    redirect(`/jobs/${stage.jobId}?shift=${[...new Set(stoppedEmployeeIds)].join(",")}`);
  }
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

// Stop one worker's clock (stage work or general duty) without touching
// the stage status.
export async function stopWorker(formData: FormData) {
  const user = await requireUser();
  const timeLogId = String(formData.get("timeLogId") ?? "");
  const log = await db.timeLog.findUniqueOrThrow({ where: { id: timeLogId } });
  assertUnitAccess(user, log.unitId);
  if (log.endedAt) return;
  await db.timeLog.update({
    where: { id: timeLogId },
    data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
  });
  await audit(user.id, "timelog.stop", "TimeLog", timeLogId, { reason: "manual stop" });
  if (log.jobId) revalidateJob(log.jobId);
  revalidatePath("/");
  revalidatePath("/employees");
}

// Put a worker on a general duty — material handling or dispatch — for a
// unit. Works exactly like a stage assignment: any open clock is closed
// first, and the new clock runs until stopped or the worker punches out.
export async function assignGeneralDuty(formData: FormData) {
  const user = await requireUser();
  const unitId = String(formData.get("unitId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  const activity = String(formData.get("activity") ?? "") as
    | "MATERIAL_HANDLING"
    | "DISPATCH"
    | "PLATE_CUTTING"
    | "STRUCTURAL_CUTTING";
  if (
    !employeeId ||
    !["MATERIAL_HANDLING", "DISPATCH", "PLATE_CUTTING", "STRUCTURAL_CUTTING"].includes(activity)
  )
    return;
  assertUnitAccess(user, unitId);
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

  await db.$transaction(async (tx) => {
    const open = await tx.timeLog.findMany({ where: { employeeId, endedAt: null } });
    if (open.some((l) => l.activity === activity && l.unitId === unitId)) return;
    for (const log of open) {
      await tx.timeLog.update({
        where: { id: log.id },
        data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
      });
      await audit(user.id, "timelog.stop", "TimeLog", log.id, { reason: "reassigned to general duty" }, tx);
    }
    const newLog = await tx.timeLog.create({
      data: {
        employeeId,
        unitId,
        activity,
        startSource: "MANUAL",
        startedById: user.id,
      },
    });
    await audit(user.id, "timelog.assignDuty", "TimeLog", newLog.id, {
      employeeId,
      employeeCode: employee.code,
      activity,
      unitId,
    }, tx);
  });
  revalidatePath("/");
  revalidatePath("/employees");
}

// Set a task's due date after it has started. Write-once for supervisors —
// once entered, only admins can change it.
export async function setStageDue(formData: FormData) {
  const user = await requireUser();
  const stageId = String(formData.get("stageId") ?? "");
  const dueRaw = String(formData.get("dueAt") ?? "");
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  if (!dueAt || isNaN(dueAt.getTime())) return;
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { job: true },
  });
  assertUnitAccess(user, stage.job.unitId);
  if (stage.dueAt !== null && !isAdmin(user)) {
    throw new Error("The task due date is already set — only admins can change it.");
  }
  await db.stage.update({ where: { id: stageId }, data: { dueAt } });
  await audit(user.id, "stage.due", "Stage", stageId, {
    jobId: stage.jobId,
    dueAt: dueAt.toISOString(),
    changed: stage.dueAt !== null,
  });
  revalidateJob(stage.jobId);
}

// Complete a stage — the quality check. The name of whoever inspected/
// checked the work is compulsory and stored on the stage.
export async function completeStage(formData: FormData) {
  const user = await requireUser();
  const stageId = String(formData.get("stageId") ?? "");
  const inspectedBy = String(formData.get("inspectedBy") ?? "").trim();
  if (!inspectedBy) return;
  const stage = await db.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: { job: true },
  });
  assertUnitAccess(user, stage.job.unitId);
  if (stage.job.status === "COMPLETED") return;

  const stoppedEmployeeIds: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.stage.update({
      where: { id: stageId },
      data: {
        status: "DONE",
        completedAt: new Date(),
        inspectedBy,
        inspectedAt: new Date(),
      },
    });
    const open = await tx.timeLog.findMany({ where: { stageId, endedAt: null } });
    for (const log of open) {
      await tx.timeLog.update({
        where: { id: log.id },
        data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
      });
      stoppedEmployeeIds.push(log.employeeId);
    }
    await audit(user.id, "stage.done", "Stage", stageId, {
      jobId: stage.jobId,
      inspectedBy,
    }, tx);
  });
  revalidateJob(stage.jobId);
  // The stage's workers are free now — ask where each one is going.
  if (stoppedEmployeeIds.length > 0) {
    redirect(`/jobs/${stage.jobId}?shift=${[...new Set(stoppedEmployeeIds)].join(",")}`);
  }
}

// Record rework on a stage. The reason is mandatory; the stage moves to the
// REWORK state (reopening it if it was Done) so the board shows what rework
// is going on.
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
    await tx.stage.update({
      where: { id: stageId },
      data: {
        status: "REWORK",
        completedAt: null,
        startedAt: stage.startedAt ?? new Date(),
      },
    });
    if (stage.job.status === "NOT_STARTED") {
      await tx.job.update({ where: { id: stage.jobId }, data: { status: "IN_PROGRESS" } });
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

// Evening night plan for one running clock: till 10 PM, full night
// (2:30 AM), or back to normal. The clock auto-stops at the cutoff.
export async function setShiftPlan(formData: FormData) {
  const user = await requireUser();
  const timeLogId = String(formData.get("timeLogId") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const log = await db.timeLog.findUniqueOrThrow({ where: { id: timeLogId } });
  assertUnitAccess(user, log.unitId);
  if (log.endedAt) return;

  const { shiftPlanEnd } = await import("@/lib/shift");
  const plannedEndAt =
    plan === "TEN_PM" || plan === "FULL_NIGHT" ? shiftPlanEnd(plan) : null;
  await db.timeLog.update({ where: { id: timeLogId }, data: { plannedEndAt } });
  await audit(user.id, "timelog.shiftPlan", "TimeLog", timeLogId, {
    plan,
    plannedEndAt: plannedEndAt?.toISOString() ?? null,
  });
  if (log.jobId) revalidateJob(log.jobId);
  revalidatePath("/");
  revalidatePath("/employees");
}

// Put a worker on dispatch loading for a specific job (used from the
// Ready to Dispatch section) — clocked like any other work, against the job.
export async function assignDispatchWorker(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (job.status === "COMPLETED") return;
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });

  await db.$transaction(async (tx) => {
    const open = await tx.timeLog.findMany({ where: { employeeId, endedAt: null } });
    if (open.some((l) => l.jobId === jobId && l.activity === "DISPATCH")) return;
    for (const log of open) {
      await tx.timeLog.update({
        where: { id: log.id },
        data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
      });
      await audit(user.id, "timelog.stop", "TimeLog", log.id, { reason: "moved to dispatch" }, tx);
    }
    const newLog = await tx.timeLog.create({
      data: {
        employeeId,
        jobId,
        unitId: job.unitId,
        activity: "DISPATCH",
        startSource: "MANUAL",
        startedById: user.id,
      },
    });
    await audit(user.id, "timelog.assignDispatch", "TimeLog", newLog.id, {
      employeeId,
      employeeCode: employee.code,
      jobId,
    }, tx);
  });
  revalidatePath("/");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/employees");
}

// Shift one freed-up worker to their next work: another stage of the job,
// or a general duty. Used by the "where is this person going now?" panel
// that appears after a stage is marked Done or Paused.
export async function shiftWorker(formData: FormData) {
  await requireUser(); // permissions enforced again inside the called actions
  const employeeId = String(formData.get("employeeId") ?? "");
  const target = String(formData.get("target") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const remaining = String(formData.get("remaining") ?? "")
    .split(",")
    .filter((id) => id && id !== employeeId);

  if (target.startsWith("stage:")) {
    const fd = new FormData();
    fd.set("stageId", target.slice("stage:".length));
    fd.set("employeeId", employeeId);
    await assignWorker(fd);
  } else if (target.startsWith("duty:")) {
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    const fd = new FormData();
    fd.set("unitId", job.unitId);
    fd.set("employeeId", employeeId);
    fd.set("activity", target.slice("duty:".length));
    await assignGeneralDuty(fd);
  }
  // target "none" = leave the worker stopped for now.

  redirect(remaining.length > 0 ? `/jobs/${jobId}?shift=${remaining.join(",")}` : `/jobs/${jobId}`);
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
