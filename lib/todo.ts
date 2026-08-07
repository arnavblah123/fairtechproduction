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
          poAwaited: true,
          poAwaitedAt: true,
          poExpectedBy: true,
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
  // Jobs without a PO. Ones marked "not received yet" drop off the list
  // until the promised date passes (or two weeks go by with no date), so a
  // PO the customer simply hasn't issued stops nagging — but is never lost.
  const CHASE_AFTER = 14 * DAY;
  const poStillDue = (j: { poAwaited: boolean; poAwaitedAt: Date | null; poExpectedBy: Date | null }) => {
    if (!j.poAwaited) return true;
    if (j.poExpectedBy) return j.poExpectedBy.getTime() < Date.now();
    return (j.poAwaitedAt?.getTime() ?? 0) + CHASE_AFTER < Date.now();
  };
  const noPo = activeJobs.filter((j) => !j.poNumber || !j.poNumber.trim() || !j.poValue);
  const missingPo = noPo.filter(poStillDue);
  // Waiting quietly — shown as a note, not counted as a pending chore.
  const poAwaiting = noPo.filter((j) => !poStillDue(j));

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
    poAwaiting,
    inspectionTests,
    ownerTodos,
    copySourceByName,
    total,
  };
}
