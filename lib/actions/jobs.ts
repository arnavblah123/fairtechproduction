"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";
import { syncJobToCalendar, deleteCalendarEvent } from "@/lib/google-calendar";
import { readUploadedFiles, type PendingAttachment } from "@/lib/attachments";
import type { JobStatus } from "@prisma/client";
import type { FormState } from "./auth";

// Job creation (spec §4): client/buyer/PO/unit/description, template or
// custom stages, mandatory expected completion date, optional save-as-template.
// Supervisors may create jobs too (scoped to their units); editing client/
// pricing details and completing jobs remain admin-only.
export async function createJob(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();

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
  // Material availability: "no" must say what's needed and by when — that
  // auto-raises a Material Shortage issue on the new job.
  const materialReady = String(formData.get("materialReady") ?? "yes") !== "no";
  const materialNote = String(formData.get("materialNote") ?? "").trim();
  const materialNeededByRaw = String(formData.get("materialNeededBy") ?? "");
  // Finished weight in kg — the basis for per-kg budgets.
  const weightRaw = String(formData.get("finishedWeightKg") ?? "").trim();
  const finishedWeightKg = weightRaw ? Number(weightRaw) : null;
  // Where this goes: straight onto a unit's board, or into the order book to
  // be released later. Same form either way.
  const destination = String(formData.get("destination") ?? "PRODUCTION");
  // Set when the form was opened from an order-book entry — that entry is
  // removed once the real job exists, so the work is never counted twice.
  const fromFutureJobId = String(formData.get("fromFutureJobId") ?? "") || null;

  if (!clientName || !description || !unitId) {
    return { error: "Client name, description and unit are required." };
  }
  if (finishedWeightKg !== null && (!isFinite(finishedWeightKg) || finishedWeightKg <= 0)) {
    return { error: "Finished weight must be a number greater than 0." };
  }
  try {
    assertUnitAccess(user, unitId);
  } catch {
    return { error: "You do not have access to that unit." };
  }

  // Order book: the company has taken the order but no unit is building it
  // yet. Nothing is scheduled, no stages are created and no clock can start,
  // so the shop-floor questions — material, drawings, testing — are asked
  // when the order is released, not now. The delivery date is optional here
  // because orders are routinely booked before one is committed.
  if (destination === "ORDER_BOOK") {
    const orderExpected = expectedCompletionRaw ? new Date(expectedCompletionRaw) : null;
    if (orderExpected && isNaN(orderExpected.getTime())) {
      return { error: "Expected completion date is invalid." };
    }
    const entry = await db.futureJob.create({
      data: {
        clientName,
        buyerName,
        poNumber,
        description,
        unitId,
        expectedCompletion: orderExpected,
        finishedWeightKg,
        reminderDaysBefore: isNaN(reminderDaysBefore) ? 7 : reminderDaysBefore,
        priority,
        templateId,
        stagesText: customStagesRaw.trim() || null,
        addedById: user.id,
      },
    });
    await audit(user.id, "futureJob.add", "FutureJob", entry.id, {
      clientName,
      unitId,
      via: "job form",
    });
    revalidatePath("/");
    revalidatePath("/planning");
    redirect("/");
  }

  if (!materialReady && !materialNote) {
    return { error: "Material not available — write what material is needed." };
  }
  if (!materialReady && !materialNeededByRaw) {
    return { error: "Material not available — give the date it is needed by." };
  }
  if (!expectedCompletionRaw) {
    return { error: "Expected completion date is mandatory." };
  }
  const expectedCompletion = new Date(expectedCompletionRaw);
  if (isNaN(expectedCompletion.getTime())) {
    return { error: "Expected completion date is invalid." };
  }

  // Stage list always comes from the submitted lines — a template pre-fills
  // them in the form but they are editable per job (the template itself is
  // never modified). templateId is kept as a reference for reporting.
  const stages = customStagesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, description: null as string | null }));
  if (stages.length === 0) {
    return { error: "Enter at least one stage (or pick a template to pre-fill them)." };
  }

  // Testing plan: checked test types, each tied to a stage line (1-based
  // index) or to the whole job (empty = final).
  const tests: { name: string; stageIndex: number | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("test_") || value !== "on") continue;
    const name = String(formData.get(`${key}_name`) ?? "").trim();
    if (!name) continue;
    const idxRaw = String(formData.get(`${key}_stage`) ?? "");
    const idx = idxRaw ? Number(idxRaw) : NaN;
    tests.push({
      name,
      stageIndex: Number.isInteger(idx) && idx >= 1 && idx <= stages.length ? idx : null,
    });
  }
  const otherTest = String(formData.get("otherTest") ?? "").trim();
  if (otherTest) {
    const idxRaw = String(formData.get("otherTest_stage") ?? "");
    const idx = idxRaw ? Number(idxRaw) : NaN;
    tests.push({
      name: otherTest,
      stageIndex: Number.isInteger(idx) && idx >= 1 && idx <= stages.length ? idx : null,
    });
  }

  // Each test becomes its own timed stage, inserted right after the stage it
  // follows (or at the end for final tests) — so testing work is assigned
  // and clocked like any other stage.
  const finalStages: { name: string; description: string | null; testIdx: number | null }[] =
    stages.map((s) => ({ ...s, testIdx: null }));
  tests
    .map((t, ti) => ({ ...t, ti }))
    .filter((t) => t.stageIndex !== null)
    .sort((a, b) => b.stageIndex! - a.stageIndex!)
    .forEach((t) => {
      finalStages.splice(t.stageIndex!, 0, { name: t.name, description: "Testing", testIdx: t.ti });
    });
  tests
    .map((t, ti) => ({ ...t, ti }))
    .filter((t) => t.stageIndex === null)
    .forEach((t) => {
      finalStages.push({ name: t.name, description: "Testing", testIdx: t.ti });
    });

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

  // Set when the job is created with material missing — alerted after commit.
  let autoIssueId: string | null = null;
  const job = await db.$transaction(async (tx) => {
    let usedTemplateId = templateId;

    // Save the (possibly edited) stage list as a new template if asked —
    // even when it started from an existing template.
    if (saveAsTemplate) {
      const existing = await tx.jobTemplate.findUnique({ where: { name: saveAsTemplate } });
      if (existing) throw new Error(`A template named "${saveAsTemplate}" already exists.`);
      const newTemplate = await tx.jobTemplate.create({
        data: {
          name: saveAsTemplate,
          // Remember which equipment this process is for, so typing the same
          // description next time auto-selects this template.
          equipmentName: description,
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
        materialReady,
        finishedWeightKg,
        templateId: usedTemplateId,
        createdById: user.id,
        stages: {
          create: finalStages.map((s, i) => ({
            name: s.name,
            description: s.description,
            sequence: i + 1,
          })),
        },
      },
    });
    if (tests.length > 0) {
      const createdStages = await tx.stage.findMany({
        where: { jobId: created.id },
        orderBy: { sequence: "asc" },
      });
      await tx.jobTest.createMany({
        data: finalStages
          .map((s, pos) => ({ s, pos }))
          .filter(({ s }) => s.testIdx !== null)
          .map(({ s, pos }) => ({
            jobId: created.id,
            name: s.name,
            stageId: createdStages[pos]?.id ?? null,
          })),
      });
    }
    if (attachments.length > 0) {
      await tx.jobAttachment.createMany({
        data: attachments.map((a) => ({
          ...a,
          jobId: created.id,
          uploadedById: user.id,
        })),
      });
    }
    if (!materialReady) {
      const neededBy = new Date(materialNeededByRaw);
      const issue = await tx.issue.create({
        data: {
          jobId: created.id,
          unitId,
          type: "MATERIAL_SHORTAGE",
          description: `Material needed: ${materialNote}${
            isNaN(neededBy.getTime())
              ? ""
              : ` — needed by ${neededBy.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "Asia/Kolkata",
                })}`
          }`,
          dueAt: isNaN(neededBy.getTime()) ? null : neededBy,
          raisedById: user.id,
        },
      });
      autoIssueId = issue.id;
      await audit(user.id, "issue.autoRaise", "Issue", issue.id, {
        jobId: created.id,
        reason: "material not available at job creation",
      }, tx);
    }
    // Released from the order book: drop the booking in the same transaction
    // that creates the job, so the order can never sit in both places.
    if (fromFutureJobId) {
      const removed = await tx.futureJob.deleteMany({ where: { id: fromFutureJobId } });
      if (removed.count > 0) {
        await audit(user.id, "futureJob.release", "FutureJob", fromFutureJobId, {
          jobId: created.id,
        }, tx);
      }
    }
    await audit(user.id, "job.create", "Job", created.id, {
      clientName,
      unitId,
      attachments: attachments.map((a) => a.filename),
    }, tx);
    return created;
  }).catch((err: Error) => ({ error: err.message }));

  if ("error" in job) return { error: job.error };
  if (autoIssueId) {
    const { sendIssueAlert } = await import("@/lib/issue-alert");
    await sendIssueAlert(autoIssueId); // WhatsApp to Jagdish + owner
  }
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
  const unitId = String(formData.get("unitId") ?? "") || job.unitId;
  if (!clientName || !description || !expectedCompletionRaw) {
    return { error: "Client, description and expected completion are required." };
  }
  if (unitId !== job.unitId) {
    try {
      assertUnitAccess(user, unitId);
    } catch {
      return { error: "You do not have access to that unit." };
    }
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
      unitId,
    },
  });

  if (unitId !== job.unitId) {
    // Carry over anything still running under the old unit — closed/historical
    // logs stay put, they're a record of where the work actually happened.
    await db.timeLog.updateMany({
      where: { jobId, unitId: job.unitId, endedAt: null },
      data: { unitId },
    });
    await db.craneLog.updateMany({
      where: { jobId, unitId: job.unitId, endedAt: null },
      data: { unitId },
    });
    await audit(user.id, "job.moveUnit", "Job", jobId, { from: job.unitId, to: unitId });
  }

  await audit(user.id, "job.update", "Job", jobId);
  await syncJobToCalendar(jobId); // date/reminder may have changed
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return undefined;
}

// Dispatched ✓ — supervisors included. Requires the PO value (without GST);
// closes the job, keeps all data, and emails the owner the full cost
// breakdown against that PO value.
export async function dispatchJob(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const poValue = Number(String(formData.get("poValue") ?? "").trim());
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (job.status !== "READY_TO_DISPATCH") {
    throw new Error("Only jobs in Ready to Dispatch can be marked dispatched.");
  }
  const havePo = !isNaN(poValue) && poValue > 0;
  // The PO value is required — unless the job is marked "PO not received
  // yet", in which case the goods can still leave and the value is filled in
  // when the customer finally issues it.
  if (!havePo && !job.poAwaited) {
    throw new Error("Enter the job's PO value (without GST).");
  }

  await db.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ...(havePo ? { poValue, poAwaited: false, poAwaitedAt: null, poExpectedBy: null } : {}),
      },
    });
    const open = await tx.timeLog.findMany({ where: { jobId, endedAt: null } });
    for (const log of open) {
      await tx.timeLog.update({
        where: { id: log.id },
        data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
      });
    }
    await audit(user.id, "job.dispatch", "Job", jobId, { poValue }, tx);
  });

  // Owner's cost-breakdown email — best-effort, never blocks the dispatch.
  try {
    const { buildDispatchCostEmail } = await import("@/lib/cost-report");
    const { sendOwnerEmail } = await import("@/lib/email");
    const mail = await buildDispatchCostEmail(jobId);
    if (mail) await sendOwnerEmail(mail.subject, mail.html);
  } catch (err) {
    console.error("dispatch email failed:", err);
  }

  revalidatePath("/");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
}

// Finished weight, editable after creation — older jobs have none yet and
// the weight is often confirmed only once the job is built.
export async function setJobWeight(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const raw = String(formData.get("finishedWeightKg") ?? "").trim();
  const kg = raw ? Number(raw) : null;
  if (kg !== null && (!isFinite(kg) || kg <= 0)) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  await db.job.update({ where: { id: jobId }, data: { finishedWeightKg: kg } });
  await audit(user.id, "job.setWeight", "Job", jobId, { finishedWeightKg: kg });
  revalidatePath(`/jobs/${jobId}`);
}

export async function setJobStatus(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const status = String(formData.get("status") ?? "") as JobStatus;
  const [user, job] = await Promise.all([
    requireUser(),
    db.job.findUniqueOrThrow({ where: { id: jobId } }),
  ]);
  assertUnitAccess(user, job.unitId);
  // Supervisors may move jobs between In Progress / On Hold; only admins may
  // complete or reset a job.
  if (!isAdmin(user) && (status === "COMPLETED" || status === "NOT_STARTED")) {
    throw new Error("Only admins can complete or reset a job.");
  }

  await db.$transaction([
    db.job.update({
      where: { id: jobId },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
    }),
    // Completing closes any still-open time logs on this job.
    ...(status === "COMPLETED"
      ? [
          db.timeLog.updateMany({
            where: { jobId, endedAt: null },
            data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
          }),
        ]
      : []),
  ]);
  // History write and the Google Calendar round trip both happen after the
  // response — the click never waits on either.
  after(() =>
    audit(user.id, "job.status", "Job", jobId, { status }).catch((e) =>
      console.error("audit failed:", e)
    )
  );
  after(() =>
    syncJobToCalendar(jobId).catch((e) => console.error("calendar sync failed:", e))
  );
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/");
}

// Rank an upcoming (not started) job in the unit's queue — lower number
// starts first. Any supervisor/admin with unit access can set it.
export async function setJobRank(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const rank = Number(formData.get("rank"));
  if (!Number.isInteger(rank) || rank < 1 || rank > 999) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  await db.job.update({ where: { id: jobId }, data: { priorityRank: rank } });
  await audit(user.id, "job.rank", "Job", jobId, { rank });
  revalidatePath("/");
  revalidatePath("/jobs");
}

// Supervisor's Final Done: all production work on the job is finished.
// Requires the estimated dispatch date, stops every clock on the job, and
// moves it to Ready to Dispatch. The admin's Mark Completed remains the
// final closure at actual dispatch.
export async function finalDone(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const estRaw = String(formData.get("estimatedDispatch") ?? "");
  const estimatedDispatchAt = estRaw ? new Date(estRaw) : null;
  if (!estimatedDispatchAt || isNaN(estimatedDispatchAt.getTime())) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (job.status === "COMPLETED") return;

  const stoppedEmployeeIds: string[] = [];
  await db.$transaction(async (tx) => {
    await tx.job.update({
      where: { id: jobId },
      data: { status: "READY_TO_DISPATCH", estimatedDispatchAt },
    });
    const open = await tx.timeLog.findMany({ where: { jobId, endedAt: null } });
    for (const log of open) {
      await tx.timeLog.update({
        where: { id: log.id },
        data: { endedAt: new Date(), endSource: "MANUAL", endedById: user.id },
      });
      stoppedEmployeeIds.push(log.employeeId);
    }
    await audit(user.id, "job.finalDone", "Job", jobId, {
      estimatedDispatchAt: estimatedDispatchAt.toISOString(),
    }, tx);
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/");
  if (stoppedEmployeeIds.length > 0) {
    redirect(`/jobs/${jobId}?shift=${[...new Set(stoppedEmployeeIds)].join(",")}`);
  }
}

// Undo a Final Done pressed by mistake: pull the job back out of Ready to
// Dispatch and put it where it was — In Progress, with the estimated
// dispatch date cleared. Admin-only, because the supervisor who pressed it
// is the one being corrected. Clocks stopped by the Final Done stay
// stopped; workers are put back on their stages the normal way.
export async function undoFinalDone(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (!isAdmin(user)) {
    throw new Error("Only admins can take a job out of Ready to Dispatch.");
  }
  if (job.status !== "READY_TO_DISPATCH") {
    throw new Error("This job is not in Ready to Dispatch.");
  }

  await db.job.update({
    where: { id: jobId },
    data: { status: "IN_PROGRESS", estimatedDispatchAt: null },
  });
  await audit(user.id, "job.undoFinalDone", "Job", jobId, {
    from: "READY_TO_DISPATCH",
    to: "IN_PROGRESS",
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/");
}

// Undo a Dispatched ✓ pressed by mistake: reopen the completed job back
// into Ready to Dispatch so it shows on the dashboard again. The PO value
// is kept — the dispatch form prefills it — and completedAt is cleared so
// the job leaves History. Admin-only, same as Mark Completed.
export async function reopenJob(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (!isAdmin(user)) throw new Error("Only admins can reopen a completed job.");
  if (job.status !== "COMPLETED") throw new Error("This job is not completed.");

  await db.job.update({
    where: { id: jobId },
    data: { status: "READY_TO_DISPATCH", completedAt: null },
  });
  await audit(user.id, "job.reopen", "Job", jobId, {
    from: "COMPLETED",
    to: "READY_TO_DISPATCH",
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/history");
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
