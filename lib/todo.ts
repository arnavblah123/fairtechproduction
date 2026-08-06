import { db } from "@/lib/db";
import { istToday } from "@/lib/overheads";
import type { SessionUser } from "@/lib/session";

// The supervisors' morning list: everything pending that the app can detect,
// plus owner-added items. Rebuilt live on every view — nothing to maintain.

const DAY = 86400000;

export async function buildTodoData(user: SessionUser) {
  const scoped = user.role !== "SUPERADMIN";
  const unitIn = { in: user.unitIds };
  const jobScope = scoped ? { unitId: unitIn } : {};
  // Open clocks started before 04:00 IST today = left running overnight.
  const overnightCutoff = new Date(istToday().getTime() - 1.5 * 3600e3);

  const [lateNoReason, overnight, noDispatchDate, activeJobs, ownerTodos, inspectionTests] =
    await Promise.all([
      db.planItem.findMany({
        where: {
          done: false,
          lateReason: null,
          targetDate: { lt: new Date(Date.now() - DAY) },
          AND: [
            { OR: [{ stageId: null }, { stage: { status: { not: "DONE" } } }] },
            ...(scoped ? [{ plan: { OR: [{ unitId: null }, { unitId: unitIn }] } }] : []),
          ],
        },
        include: {
          plan: { select: { name: true } },
          job: { select: { jobNumber: true, description: true } },
          stage: { select: { sequence: true, name: true } },
        },
        orderBy: { targetDate: "asc" },
      }),
      db.timeLog.findMany({
        where: {
          endedAt: null,
          startedAt: { lt: overnightCutoff },
          ...(scoped ? { unitId: unitIn } : {}),
        },
        include: {
          employee: { select: { name: true } },
          job: { select: { id: true, jobNumber: true, description: true } },
        },
        orderBy: { startedAt: "asc" },
      }),
      db.job.findMany({
        where: { status: "IN_PROGRESS", estimatedDispatchAt: null, ...jobScope },
        select: { id: true, jobNumber: true, description: true, clientName: true },
        orderBy: { expectedCompletion: "asc" },
      }),
      db.job.findMany({
        where: { status: { in: ["NOT_STARTED", "IN_PROGRESS"] }, ...jobScope },
        select: {
          id: true,
          jobNumber: true,
          description: true,
          clientName: true,
          poNumber: true,
          poValue: true,
          attachments: { where: { kind: "DRAWING" }, select: { id: true }, take: 1 },
        },
        orderBy: { jobNumber: "asc" },
      }),
      db.todoItem.findMany({
        where: {
          done: false,
          ...(scoped ? { OR: [{ unitId: null }, { unitId: unitIn }] } : {}),
        },
        include: {
          createdBy: { select: { name: true } },
          job: { select: { jobNumber: true, description: true } },
          unit: { select: { code: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.jobTest.findMany({
        where: {
          stage: { status: { in: ["ACTIVE", "REWORK"] } },
          job: { status: "IN_PROGRESS", ...jobScope },
        },
        include: {
          job: { select: { id: true, jobNumber: true, description: true } },
          stage: { select: { name: true } },
        },
      }),
    ]);

  const missingDrawings = activeJobs.filter((j) => j.attachments.length === 0);
  const missingPo = activeJobs.filter(
    (j) => !j.poNumber || !j.poNumber.trim() || !j.poValue
  );

  // Reuse suggestion: an earlier job with the same name that has drawings.
  const copySources =
    missingDrawings.length > 0
      ? await db.job.findMany({
          where: {
            description: { in: [...new Set(missingDrawings.map((j) => j.description))] },
            attachments: { some: { kind: "DRAWING" } },
          },
          orderBy: { jobNumber: "desc" },
          select: { id: true, jobNumber: true, description: true },
        })
      : [];
  const copySourceByName = new Map<string, { id: string; jobNumber: number }>();
  for (const s of copySources) {
    if (!copySourceByName.has(s.description)) {
      copySourceByName.set(s.description, { id: s.id, jobNumber: s.jobNumber });
    }
  }

  // Today's road-map labour plan: who is supposed to be on which activity.
  // Not counted in the to-do total — it's the morning's work order, not a
  // chore to tick off.
  const t0 = istToday();
  const roadmapToday = await db.stagePlanWorker.findMany({
    where: {
      stage: {
        plannedStart: { lte: t0 },
        plannedEnd: { gte: t0 },
        status: { not: "DONE" },
        job: { status: { notIn: ["COMPLETED"] }, ...jobScope },
      },
    },
    include: {
      employee: { select: { id: true, name: true, skill: true } },
      stage: {
        select: {
          id: true,
          name: true,
          sequence: true,
          status: true,
          job: { select: { id: true, jobNumber: true, description: true } },
        },
      },
    },
  });
  // Group by activity so a supervisor reads "this stage → these people".
  const roadmapByStage = new Map<
    string,
    {
      stageName: string;
      sequence: number;
      started: boolean;
      jobId: string;
      jobNumber: number;
      jobDescription: string;
      workers: { id: string; name: string; skill: string }[];
    }
  >();
  for (const a of roadmapToday) {
    const row =
      roadmapByStage.get(a.stageId) ??
      {
        stageName: a.stage.name,
        sequence: a.stage.sequence,
        started: a.stage.status === "ACTIVE",
        jobId: a.stage.job.id,
        jobNumber: a.stage.job.jobNumber,
        jobDescription: a.stage.job.description,
        workers: [],
      };
    row.workers.push(a.employee);
    roadmapByStage.set(a.stageId, row);
  }
  const roadmapPlan = [...roadmapByStage.values()].sort(
    (a, b) => a.jobNumber - b.jobNumber || a.sequence - b.sequence
  );

  const total =
    lateNoReason.length +
    overnight.length +
    noDispatchDate.length +
    missingDrawings.length +
    missingPo.length +
    inspectionTests.length +
    ownerTodos.length;

  return {
    lateNoReason,
    overnight,
    noDispatchDate,
    missingDrawings,
    missingPo,
    inspectionTests,
    ownerTodos,
    copySourceByName,
    roadmapPlan,
    total,
  };
}
