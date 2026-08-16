import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, canAccessUnit, isAdmin, lockHrToLabour} from "@/lib/permissions";
import {
  setJobStatus,
  deleteJob,
  finalDone,
  setJobWeight,
  undoFinalDone,
  reopenJob,
} from "@/lib/actions/jobs";
import { setStageStatus, completeStage, assignWorker, stopWorker, addStage, recordRework, setShiftPlan, setStageDue } from "@/lib/actions/stages";
import { shiftPlanLabel } from "@/lib/shift";
import { heldItems } from "@/lib/inventory";
import { raiseIssue, resolveIssue } from "@/lib/actions/issues";
import { addJobTest, deleteJobTest } from "@/lib/actions/tests";
import {
  JobStatusBadge,
  StageStatusBadge,
  IssueBadge,
  PriorityBadge,
} from "@/components/badges";
import { LiveDuration } from "@/components/live-duration";
import { formatDate, formatDateTime, formatDuration, istDateInput, jobCode } from "@/lib/format";
import { googleCalendarLink, isCalendarConfigured } from "@/lib/google-calendar";
import { DrawingPicker } from "@/components/drawing-picker";
import { QuickAddEmployee } from "@/components/quick-add-employee";
import { ActionButton, PendingSubmit } from "@/components/instant";
import { SearchSelect } from "@/components/search-select";
import { ShiftWorkerRow } from "@/components/shift-worker-row";
import { JobCalendar } from "@/components/job-calendar";
import { jobAlerts } from "@/lib/job-alerts";
import { deleteAttachment } from "@/lib/actions/attachments";
import { ATTACHMENT_KIND_LABELS, formatFileSize } from "@/lib/attachments";
import { workedByStage, fmtWorked } from "@/lib/idle";
import { formatMoney } from "@/lib/format";
import { overheadByJob } from "@/lib/overheads";
import { getConsumableCostsWithStatus } from "@/lib/consumables";
import { getConsumableItems } from "@/lib/consumable-items";
import { otOverlapMinutes } from "@/lib/ot";
import { updateOverheadItem } from "@/lib/actions/overheads";

export const dynamic = "force-dynamic";

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ shift?: string; m?: string; stage?: string }>;
}) {
  const user = await requireUser();
  lockHrToLabour(user);
  const { id } = await params;
  const { shift, m, stage: stageParam } = await searchParams;

  const job = await db.job.findUnique({
    where: { id },
    include: {
      unit: true,
      template: true,
      createdBy: true,
      stages: {
        orderBy: { sequence: "asc" },
        include: {
          timeLogs: {
            where: { endedAt: null },
            include: { employee: true },
          },
          reworks: {
            orderBy: { createdAt: "desc" },
            include: { raisedBy: { select: { name: true } } },
          },
        },
      },
      issues: {
        orderBy: { createdAt: "desc" },
        include: { raisedBy: true, resolvedBy: true },
      },
      tests: {
        orderBy: { createdAt: "asc" },
        include: { stage: { select: { id: true, name: true, sequence: true } } },
      },
      attachments: {
        orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          filename: true,
          mimeType: true,
          size: true,
          createdAt: true,
          sourceJobId: true,
          uploadedBy: { select: { name: true } },
        },
      },
      timeLogs: {
        orderBy: { startedAt: "desc" },
        take: 50,
        include: { employee: true, stage: true, startedBy: true, endedBy: true },
      },
    },
  });
  if (!job || !canAccessUnit(user, job.unitId)) notFound();

  // Everything below depends only on the job row above — one round trip.
  const shiftIds = (shift ?? "").split(",").filter(Boolean);
  const [
    employees,
    allStageLogs,
    costLogs,
    overheadMap,
    consumableData,
    overheadItems,
    alerts,
    shiftEmployees,
    shiftJobsRaw,
    consumableItems,
  ] = await Promise.all([
    // Workers available for assignment: the pool is shared — any active worker
    // from any unit can be put on this job. Grouped with this job's unit first.
    db.employee.findMany({
      where: { active: true },
      include: { primaryUnit: true },
      orderBy: { name: "asc" },
    }),
    // Total actively-worked time per stage across every session — survives
    // pause/restart/rework and never counts idle gaps between sessions.
    db.timeLog.findMany({
      where: { jobId: id, stageId: { not: null } },
      select: {
        stageId: true,
        startedAt: true,
        endedAt: true,
        endSource: true,
        otBonusMinutes: true,
        // Wage is rendered only in the owner's stage-cost line, never in
        // the session history that everyone sees.
        employee: { select: { name: true, hourlyWage: true } },
      },
      orderBy: { startedAt: "desc" },
    }),
    // Job cost: every logged hour on this job × that worker's hourly wage.
    db.timeLog.findMany({
      where: { jobId: id },
      select: {
        startedAt: true,
        endedAt: true,
        otBonusMinutes: true,
        employee: { select: { id: true, name: true, hourlyWage: true } },
      },
    }),
    // Supervisor-salary overheads: punched-in days ÷ 30, split over the unit's
    // jobs running each day.
    overheadByJob([id]),
    // Consumables issued to this job in the Store app — owner-only figures.
    user.role === "SUPERADMIN" ? getConsumableCostsWithStatus() : Promise.resolve(null),
    // Running fixed overheads that touch this job's unit — editable in place.
    user.role === "SUPERADMIN"
      ? db.overheadItem.findMany({
          where: {
            endedAt: null,
            OR: [{ units: { none: {} } }, { units: { some: { unitId: job.unitId } } }],
          },
          include: { units: { select: { unit: { select: { code: true } } } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    // Delays and pending items on this job — shown before anything else.
    jobAlerts([id])
      .then((m) => m.get(id) ?? null)
      .catch((e) => {
        console.error("job alerts failed:", e);
        return null;
      }),
    // Workers freed by a just-completed/paused stage, awaiting their next work.
    shiftIds.length
      ? db.employee.findMany({
          where: { id: { in: shiftIds }, active: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    // Destinations for the shift popup: every open job of this unit (same job
    // first) with its unfinished stages, plus the general duties.
    shiftIds.length
      ? db.job.findMany({
          where: {
            unitId: job.unitId,
            status: { in: ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD"] },
          },
          select: {
            id: true,
            jobNumber: true,
            clientName: true,
            description: true,
            stages: {
              where: { status: { not: "DONE" } },
              orderBy: { sequence: "asc" },
              select: { id: true, name: true, sequence: true },
            },
          },
          orderBy: { jobNumber: "asc" },
        })
      : Promise.resolve([]),
    // Item-by-item consumables from the Store app — the owner's view only.
    user.role === "SUPERADMIN"
      ? getConsumableItems(job.jobNumber)
      : Promise.resolve({ entries: [], problem: null }),
  ]);
  const workerGroups = [
    { label: `${job.unit.name} (this unit)`, list: employees.filter((e) => e.primaryUnitId === job.unitId) },
    ...[...new Set(employees.filter((e) => e.primaryUnitId !== job.unitId).map((e) => e.primaryUnit.name))].map(
      (unitName) => ({
        label: unitName,
        list: employees.filter((e) => e.primaryUnit.name === unitName),
      })
    ),
  ].filter((g) => g.list.length > 0);

  const stageWorked = workedByStage(allStageLogs);
  // Per-stage session history for the tap-to-open view on each card.
  const stageHistory = new Map<string, typeof allStageLogs>();
  for (const l of allStageLogs) {
    const arr = stageHistory.get(l.stageId!) ?? [];
    arr.push(l);
    stageHistory.set(l.stageId!, arr);
  }

  // ---- Owner-only stage costing --------------------------------------
  // Labour per stage is exact: each session's minutes × that worker's wage
  // (same basis as the job-level labour figure below, so stages add up).
  // Consumables per stage are apportioned: the Store knows which JOB an
  // item was issued to and on what date; each issue is split across the
  // stages that had hours logged that day. Issues on days with no stage
  // hours stay "unattributed" rather than being guessed onto a stage.
  const IST_MS = 5.5 * 3600e3;
  const istDayOf = (d: Date | string) =>
    Math.floor((new Date(d).getTime() + IST_MS) / 86400000);
  const nowMs = Date.now();
  const stageLabourCost = new Map<string, number>();
  const stageDayMinutes = new Map<number, Map<string, number>>();
  if (user.role === "SUPERADMIN") {
    for (const l of allStageLogs) {
      const endMs = Math.min((l.endedAt ?? new Date(nowMs)).getTime(), nowMs);
      const minutes = Math.max(0, (endMs - l.startedAt.getTime()) / 60000);
      const wage = l.employee.hourlyWage ?? 0;
      stageLabourCost.set(
        l.stageId!,
        (stageLabourCost.get(l.stageId!) ?? 0) + (wage * minutes) / 60
      );
      // Day attribution for the consumable split — start-day is close
      // enough here; overnight tails are minutes, not issue events.
      const day = istDayOf(l.startedAt);
      const dayMap = stageDayMinutes.get(day) ?? new Map<string, number>();
      dayMap.set(l.stageId!, (dayMap.get(l.stageId!) ?? 0) + minutes);
      stageDayMinutes.set(day, dayMap);
    }
  }
  const stageConsumables = new Map<string, number>();
  let unattributedConsumables = 0;
  const itemRollup = new Map<
    string,
    { item: string; unit: string; brands: string[]; qty: number; value: number }
  >();
  for (const entry of consumableItems.entries) {
    const key = `${entry.code}|${entry.unit}`;
    const row =
      itemRollup.get(key) ??
      { item: entry.item, unit: entry.unit, brands: entry.brands, qty: 0, value: 0 };
    row.qty += entry.qty;
    row.value += entry.value;
    itemRollup.set(key, row);

    const dayMap = stageDayMinutes.get(istDayOf(entry.date));
    const dayTotal = dayMap ? [...dayMap.values()].reduce((s, m) => s + m, 0) : 0;
    if (!dayMap || dayTotal <= 0) {
      unattributedConsumables += entry.value;
    } else {
      for (const [stageId, m] of dayMap) {
        stageConsumables.set(
          stageId,
          (stageConsumables.get(stageId) ?? 0) + (entry.value * m) / dayTotal
        );
      }
    }
  }
  const consumableItemRows = [...itemRollup.values()].sort((a, b) => b.value - a.value);
  const consumableItemsTotal = consumableItemRows.reduce((s, r) => s + r.value, 0);

  // Job cost: every logged hour on this job × that worker's hourly wage
  // (set by the owner on the Employees page). Everyone with access to the
  // job sees the totals and the labour breakdown; the overhead breakdown
  // and editing stay owner-only.
  const costEnd = job.completedAt ?? new Date();
  const perWorker = new Map<string, { name: string; wage: number | null; minutes: number }>();
  for (const l of costLogs) {
    const rec =
      perWorker.get(l.employee.id) ??
      { name: l.employee.name, wage: l.employee.hourlyWage, minutes: 0 };
    rec.minutes += Math.max(
      0,
      ((l.endedAt ?? costEnd).getTime() - l.startedAt.getTime()) / 60000
    );
    perWorker.set(l.employee.id, rec);
  }
  const workerCosts = [...perWorker.values()].sort(
    (a, b) => (b.wage ?? 0) * b.minutes - (a.wage ?? 0) * a.minutes
  );
  const labourCost = workerCosts.reduce((s, w) => s + (w.wage ?? 0) * (w.minutes / 60), 0);
  const unpricedCount = workerCosts.filter((w) => w.wage === null).length;
  const overheads = overheadMap.get(id) ?? 0;
  // When consumables are missing we say why, rather than silently showing nothing.
  const consumables = consumableData?.costs.get(job.jobNumber) ?? null;
  const consumableProblem = consumableData?.problem ?? null;
  const consumableCost = consumables?.trueCost ?? 0;

  const openIssues = job.issues.filter((i) => i.status === "OPEN");
  const totalReworks = job.stages.reduce((n, s) => n + s.reworks.length, 0);
  const admin = isAdmin(user);

  const shiftJobOptions = [
    ...shiftJobsRaw.filter((j) => j.id === job.id),
    ...shiftJobsRaw.filter((j) => j.id !== job.id),
  ]
    .filter((j) => j.stages.length > 0)
    .map((j) => ({
      id: j.id,
      label:
        j.id === job.id
          ? `Same job — ${j.description} (${jobCode(j.jobNumber)})`
          : `${j.description} · ${jobCode(j.jobNumber)} ${j.clientName}`,
      stages: j.stages.map((s) => ({ id: s.id, label: `${s.sequence}. ${s.name}` })),
    }));
  // Consumables these people are still holding, straight from the store app.
  const held = await heldItems(shiftEmployees.map((e) => e.code));
  const heldByCode = new Map(held.map((h) => [h.employeeCode, h]));

  // Live idle indicator: in progress but nobody clocked on right now.
  const openLogCount = job.stages.reduce((n, s) => n + s.timeLogs.length, 0);
  const isIdle = job.status === "IN_PROGRESS" && openLogCount === 0;
  const idleSince = isIdle
    ? job.timeLogs.find((l) => l.endedAt)?.endedAt ??
      job.stages.find((s) => s.status === "ACTIVE" || s.status === "REWORK")?.startedAt ??
      job.updatedAt
    : null;

  return (
    <div className="space-y-5">
      {/* Where are these freed-up workers going now? Blocking popup so it
          can't be scrolled past and forgotten. */}
      {shiftEmployees.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start sm:items-center justify-center p-3 overflow-y-auto">
        <section className="bg-blue-600 text-white rounded-xl shadow-2xl p-4 w-full max-w-lg my-6">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h2 className="font-semibold">
              Where are you shifting {shiftEmployees.length === 1 ? "this person" : "these people"} now?
            </h2>
            <Link
              href={`/jobs/${job.id}`}
              className="text-xs text-blue-200 hover:text-white whitespace-nowrap"
            >
              Skip ✕
            </Link>
          </div>
          <div className="space-y-2">
            {shiftEmployees.map((emp) => (
              <ShiftWorkerRow
                key={emp.id}
                employee={{ id: emp.id, name: emp.name, skill: emp.skill }}
                jobs={shiftJobOptions}
                currentJobId={job.id}
                remaining={shiftIds.filter((x) => x !== emp.id).join(",")}
                held={heldByCode.get(emp.code)?.items ?? []}
              />
            ))}
          </div>
          <p className="text-xs text-blue-200 mt-2">
            First pick the job (or duty), then the stage. Going nowhere for now?
            Just tap ✕ — the worker stays stopped.
          </p>
        </section>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{job.description}</h1>
              <span className="text-slate-400">{jobCode(job.jobNumber)}</span>
              <JobStatusBadge status={job.status} />
            {job.drawingPending && (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300"
                title="A previous job's drawing was offered but the supervisor said it may have changed — an updated drawing is still to be uploaded"
              >
                📐 Drawing pending
              </span>
            )}
              {job.priority && <PriorityBadge />}
              {openIssues.length > 0 && <IssueBadge count={openIssues.length} />}
              {totalReworks > 0 && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-purple-100 text-purple-800">
                  {totalReworks} rework{totalReworks === 1 ? "" : "s"}
                </span>
              )}
              {idleSince && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-800">
                  Nobody working — idle <LiveDuration since={idleSince} />
                </span>
              )}
            </div>
            <p className="text-slate-600 mt-1">{job.clientName}</p>
            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Unit</dt>
                <dd>{job.unit.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Due</dt>
                <dd className="font-medium">{formatDate(job.expectedCompletion)}</dd>
              </div>
              {job.estimatedDispatchAt && (
                <div>
                  <dt className="text-xs text-slate-400">Est. dispatch</dt>
                  <dd className="font-medium text-cyan-700">
                    {formatDate(job.estimatedDispatchAt)}
                  </dd>
                </div>
              )}
              {job.buyerName && (
                <div>
                  <dt className="text-xs text-slate-400">Buyer</dt>
                  <dd>{job.buyerName}</dd>
                </div>
              )}
              {job.poNumber && (
                <div>
                  <dt className="text-xs text-slate-400">PO ref</dt>
                  <dd>{job.poNumber}</dd>
                </div>
              )}
              {job.template && (
                <div>
                  <dt className="text-xs text-slate-400">Template</dt>
                  <dd>{job.template.name}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-slate-400">Finished weight</dt>
                <dd>
                  {job.finishedWeightKg ? (
                    <>
                      {job.finishedWeightKg.toLocaleString("en-IN")} kg
                      {admin && (
                        <form action={setJobWeight} className="inline-flex items-center gap-1 ml-2">
                          <input type="hidden" name="jobId" value={job.id} />
                          <input
                            name="finishedWeightKg"
                            type="number"
                            min={1}
                            step="any"
                            defaultValue={job.finishedWeightKg}
                            className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
                          />
                          <button className="text-xs text-blue-600">✓</button>
                        </form>
                      )}
                    </>
                  ) : admin ? (
                    <form action={setJobWeight} className="flex items-center gap-1">
                      <input type="hidden" name="jobId" value={job.id} />
                      <input
                        name="finishedWeightKg"
                        type="number"
                        min={1}
                        step="any"
                        placeholder="kg"
                        className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
                      />
                      <button className="text-xs text-blue-600">Set</button>
                    </form>
                  ) : (
                    <span className="text-slate-400">not set</span>
                  )}
                </dd>
              </div>
            </dl>

            {/* Labour cost — visible to the owner only. Also shown when the
                only spend so far is consumables, or when the owner needs to
                be told why the consumable figure is missing. (The comment
                always said owner-only; the role gate was missing, which
                showed every worker's wage to any job viewer.) */}
            {user.role === "SUPERADMIN" &&
              (workerCosts.length > 0 || overheads > 0 || consumableCost > 0 || consumableProblem) && (
              <details className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm max-w-xl">
                <summary className="cursor-pointer select-none font-semibold text-emerald-900">
                  💰 Cost so far: {formatMoney(labourCost + overheads + consumableCost)}
                  <span className="font-normal">
                    {" "}(labour {formatMoney(labourCost)} + overheads {formatMoney(overheads)}
                    {consumableCost > 0 ? <> + consumables {formatMoney(consumableCost)}</> : null})
                  </span>
                  {user.role === "SUPERADMIN" && unpricedCount > 0 && (
                    <span className="font-normal text-amber-700">
                      {" "}· {unpricedCount} worker{unpricedCount === 1 ? "" : "s"} without wage set
                    </span>
                  )}
                </summary>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-emerald-700">
                      <th className="py-1 pr-2">Worker</th>
                      <th className="py-1 pr-2">Hours</th>
                      <th className="py-1 pr-2">₹/hr</th>
                      <th className="py-1 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workerCosts.map((w) => (
                      <tr key={w.name} className="border-t border-emerald-100">
                        <td className="py-1 pr-2">{w.name}</td>
                        <td className="py-1 pr-2">{(w.minutes / 60).toFixed(1)}</td>
                        <td className="py-1 pr-2">
                          {w.wage !== null ? (
                            w.wage
                          ) : (
                            <span className="text-amber-700">not set</span>
                          )}
                        </td>
                        <td className="py-1 text-right font-medium">
                          {w.wage !== null ? formatMoney(w.wage * (w.minutes / 60)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {overheads > 0 && (
                  <p className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs flex justify-between">
                    <span>Overheads (this job&apos;s share of running costs)</span>
                    <span className="font-medium">{formatMoney(overheads)}</span>
                  </p>
                )}
                {/* Per-kg figures — the basis for budgeting the next job */}
                {job.finishedWeightKg && job.finishedWeightKg > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs space-y-0.5">
                    <p className="flex justify-between font-medium">
                      <span>Per kg ({job.finishedWeightKg.toLocaleString("en-IN")} kg finished)</span>
                      <span>
                        {formatMoney(
                          (labourCost + overheads + consumableCost) / job.finishedWeightKg
                        )}
                        /kg
                      </span>
                    </p>
                    <p className="flex justify-between text-emerald-700">
                      <span className="pl-3">Man-hours per kg</span>
                      <span>
                        {(
                          workerCosts.reduce((s, w) => s + w.minutes, 0) /
                          60 /
                          job.finishedWeightKg
                        ).toFixed(3)}{" "}
                        h/kg
                      </span>
                    </p>
                    {job.poValue && (
                      <p className="flex justify-between text-emerald-700">
                        <span className="pl-3">PO rate</span>
                        <span>{formatMoney(job.poValue / job.finishedWeightKg)}/kg</span>
                      </p>
                    )}
                  </div>
                )}
                {/* Consumables from the Store app — owner-only */}
                {consumables !== null && consumableCost > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs space-y-0.5">
                    <p className="flex justify-between">
                      <span>Consumables (from Store app)</span>
                      <span className="font-medium">{formatMoney(consumables.trueCost)}</span>
                    </p>
                    <p className="flex justify-between text-emerald-700">
                      <span className="pl-3">Issued directly to this job</span>
                      <span>{formatMoney(consumables.direct)}</span>
                    </p>
                    {consumables.sharedAlloc > 0 && (
                      <p className="flex justify-between text-emerald-700">
                        <span className="pl-3">Share of general shop consumables</span>
                        <span>{formatMoney(consumables.sharedAlloc)}</span>
                      </p>
                    )}
                    {consumables.overheadAlloc > 0 && (
                      <p className="flex justify-between text-emerald-700">
                        <span className="pl-3">Share of store overheads</span>
                        <span>{formatMoney(consumables.overheadAlloc)}</span>
                      </p>
                    )}
                  </div>
                )}
                {/* Why the consumable figure is blank — owner-only, so the
                    link can be fixed instead of the number just missing. */}
                {consumableProblem && (
                  <p className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs text-amber-700">
                    Consumables not shown: {consumableProblem}
                  </p>
                )}

                {/* Stage-wise cost split — owner only. Labour is exact;
                    consumables are split by which stages ran that day. */}
                {user.role === "SUPERADMIN" && stageLabourCost.size > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs">
                    <p className="font-semibold text-emerald-800 mb-1">Stage-wise cost</p>
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-emerald-700">
                          <th className="py-0.5 pr-2">Stage</th>
                          <th className="py-0.5 pr-2 text-right">Labour</th>
                          <th className="py-0.5 pr-2 text-right">Consumables*</th>
                          <th className="py-0.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.stages
                          .filter(
                            (s) =>
                              (stageLabourCost.get(s.id) ?? 0) > 0 ||
                              (stageConsumables.get(s.id) ?? 0) > 0
                          )
                          .map((s) => (
                            <tr key={s.id} className="border-t border-emerald-100">
                              <td className="py-0.5 pr-2">{s.sequence}. {s.name}</td>
                              <td className="py-0.5 pr-2 text-right">
                                {formatMoney(stageLabourCost.get(s.id) ?? 0)}
                              </td>
                              <td className="py-0.5 pr-2 text-right">
                                {formatMoney(stageConsumables.get(s.id) ?? 0)}
                              </td>
                              <td className="py-0.5 text-right font-medium">
                                {formatMoney(
                                  (stageLabourCost.get(s.id) ?? 0) +
                                    (stageConsumables.get(s.id) ?? 0)
                                )}
                              </td>
                            </tr>
                          ))}
                        {unattributedConsumables !== 0 && (
                          <tr className="border-t border-emerald-100 text-emerald-700">
                            <td className="py-0.5 pr-2">Issued/returned on days with no stage running</td>
                            <td className="py-0.5 pr-2 text-right">—</td>
                            <td className="py-0.5 pr-2 text-right">{formatMoney(unattributedConsumables)}</td>
                            <td className="py-0.5 text-right">{formatMoney(unattributedConsumables)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <p className="mt-1 text-emerald-700">
                      * consumables are split by which stages had hours logged on the day each
                      item was issued — the Store records the job, not the stage.
                    </p>
                  </div>
                )}

                {/* Item-by-item consumables from the Store — owner only */}
                {user.role === "SUPERADMIN" && consumableItemRows.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs">
                    <p className="font-semibold text-emerald-800 mb-1">
                      Consumables item by item ({formatMoney(consumableItemsTotal)})
                    </p>
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-emerald-700">
                          <th className="py-0.5 pr-2">Item</th>
                          <th className="py-0.5 pr-2">Brand</th>
                          <th className="py-0.5 pr-2 text-right">Qty</th>
                          <th className="py-0.5 text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consumableItemRows.map((r) => (
                          <tr key={`${r.item}|${r.unit}`} className="border-t border-emerald-100">
                            <td className="py-0.5 pr-2">{r.item}</td>
                            <td className="py-0.5 pr-2">{r.brands.join(", ") || "—"}</td>
                            <td className="py-0.5 pr-2 text-right whitespace-nowrap">
                              {Number(r.qty.toFixed(2)).toLocaleString("en-IN")} {r.unit}
                            </td>
                            <td className="py-0.5 text-right font-medium">{formatMoney(r.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-emerald-700">
                      Returns are netted off. Matches the &quot;issued directly&quot; figure;
                      shared shop use and store overheads stay in their pooled lines above.
                    </p>
                  </div>
                )}
                {user.role === "SUPERADMIN" && consumableItems.problem && (
                  <p className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs text-amber-700">
                    Item details not shown: {consumableItems.problem}
                  </p>
                )}

                {/* Edit the fixed overhead costs right here — changes the
                    global rate, so every job's share updates */}
                {overheadItems.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-emerald-100 space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      Edit overhead costs (applies to all jobs)
                    </p>
                    {overheadItems.map((i) => (
                      <form
                        key={i.id}
                        action={updateOverheadItem}
                        className="flex items-center gap-1.5 text-xs"
                      >
                        <input type="hidden" name="itemId" value={i.id} />
                        <input type="hidden" name="alsoRevalidate" value={`/jobs/${job.id}`} />
                        <span className="flex-1 min-w-0 truncate">
                          {i.name}
                          <span className="text-emerald-600">
                            {" "}
                            ({i.units.length === 0
                              ? "all units"
                              : i.units.map((x) => x.unit.code).sort().join(", ")})
                          </span>
                        </span>
                        <input
                          name="monthlyAmount"
                          type="number"
                          min={1}
                          step="1"
                          defaultValue={i.monthlyAmount}
                          className="w-24 rounded border border-emerald-200 px-1.5 py-1"
                        />
                        <select
                          name="period"
                          defaultValue={i.period}
                          className="rounded border border-emerald-200 px-1 py-1"
                        >
                          <option value="MONTHLY">/mo</option>
                          <option value="ANNUAL">/yr</option>
                        </select>
                        <button
                          className="rounded bg-emerald-600 text-white px-1.5 py-1"
                          title="Save — changes this cost for all jobs"
                        >
                          ✓
                        </button>
                      </form>
                    ))}
                    <Link href="/overheads" className="inline-block text-[11px] text-emerald-700 underline">
                      Manage all overheads →
                    </Link>
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-emerald-700">
                  {user.role === "SUPERADMIN"
                    ? "Wages are per worker on the Employees page; overheads = punched-in supervisor salaries and fixed costs, ÷30 per day, split over the jobs running that day."
                    : "Overheads are this job's share of the factory's running costs for the days it was worked on."}
                </p>
              </details>
            )}
            <div className="mt-2 flex items-center gap-3 text-sm">
              <a
                href={googleCalendarLink({
                  jobNumber: job.jobNumber,
                  clientName: job.clientName,
                  description: job.description,
                  expectedCompletion: job.expectedCompletion,
                  unitName: job.unit.name,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                📅 Add deadline to Google Calendar
              </a>
              {isCalendarConfigured() && (
                <span
                  className={`text-xs ${
                    job.googleEventId ? "text-green-700" : "text-slate-400"
                  }`}
                >
                  {job.googleEventId
                    ? "✓ Synced to company calendar"
                    : "Not yet synced to company calendar"}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {job.status === "IN_PROGRESS" && (
              <ActionButton
                action={setJobStatus}
                fields={{ jobId: job.id, status: "ON_HOLD" }}
                className={`${btn} bg-amber-100 text-amber-800 hover:bg-amber-200`}
                optimistic="⏸ Going on hold…"
              >
                Put On Hold
              </ActionButton>
            )}
            {job.status === "ON_HOLD" && (
              <ActionButton
                action={setJobStatus}
                fields={{ jobId: job.id, status: "IN_PROGRESS" }}
                className={`${btn} bg-blue-100 text-blue-800 hover:bg-blue-200`}
                optimistic="▶ Resuming…"
              >
                Resume
              </ActionButton>
            )}
            {/* Final Done: production finished, estimated dispatch date required */}
            {job.status !== "COMPLETED" && (
              <details className="relative">
                <summary
                  className={`${btn} inline-block cursor-pointer select-none ${
                    job.status === "READY_TO_DISPATCH"
                      ? "bg-cyan-50 text-cyan-800 hover:bg-cyan-100"
                      : "bg-cyan-600 text-white hover:bg-cyan-700"
                  }`}
                >
                  {job.status === "READY_TO_DISPATCH"
                    ? "Update dispatch date"
                    : "🚚 Ready to Dispatch"}
                </summary>
                <form
                  action={finalDone}
                  className="absolute right-0 z-10 mt-1 w-60 bg-white rounded-xl shadow-lg border border-slate-200 p-3 space-y-2"
                >
                  <input type="hidden" name="jobId" value={job.id} />
                  <label className="block text-xs font-medium text-slate-600">
                    Estimated dispatch date *
                    <input
                      type="date"
                      name="estimatedDispatch"
                      required
                      defaultValue={
                        job.estimatedDispatchAt?.toISOString().slice(0, 10) ?? ""
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button className="w-full rounded-lg bg-cyan-600 text-white py-1.5 text-sm font-medium">
                    {job.status === "READY_TO_DISPATCH"
                      ? "Save date"
                      : "Confirm: Ready to Dispatch"}
                  </button>
                  {job.status !== "READY_TO_DISPATCH" && (
                    <p className="text-[11px] text-slate-500">
                      Stops all clocks on this job and marks it Ready to Dispatch.
                    </p>
                  )}
                </form>
              </details>
            )}
            {/* Pressed by mistake? Admins can walk either step back. */}
            {admin && job.status === "READY_TO_DISPATCH" && (
              <ActionButton
                action={undoFinalDone}
                fields={{ jobId: job.id }}
                className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}
                optimistic="↩ Undoing…"
                title="Marked Ready to Dispatch by mistake — sends the job back to In Progress and clears the dispatch date"
              >
                ↩ Undo Ready to Dispatch
              </ActionButton>
            )}
            {admin && job.status === "COMPLETED" && (
              <ActionButton
                action={reopenJob}
                fields={{ jobId: job.id }}
                className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}
                optimistic="↩ Reopening…"
                title="Dispatched by mistake — reopens the job into Ready to Dispatch; it leaves History"
              >
                ↩ Reopen job
              </ActionButton>
            )}
            {admin && (
              <Link href={`/jobs/${job.id}/edit`} className={`${btn} bg-slate-100 hover:bg-slate-200`}>
                Edit
              </Link>
            )}
            {user.role === "SUPERADMIN" && (
              <details className="relative">
                <summary className={`${btn} inline-block cursor-pointer select-none bg-red-50 text-red-700 hover:bg-red-100`}>
                  Delete
                </summary>
                <form
                  action={deleteJob}
                  className="absolute right-0 z-10 mt-1 w-56 bg-white rounded-xl shadow-lg border border-red-200 p-3 space-y-2"
                >
                  <input type="hidden" name="jobId" value={job.id} />
                  <p className="text-xs text-slate-600">
                    Permanently deletes this job with all its stages, time logs
                    and documents. Cannot be undone.
                  </p>
                  <button className="w-full rounded-lg bg-red-600 text-white py-1.5 text-sm font-medium">
                    Yes, delete permanently
                  </button>
                </form>
              </details>
            )}
          </div>
        </div>
      </div>

      {/* What needs attention on this job — delays first, then pending */}
      {alerts && alerts.alerts.length > 0 && (
        <section
          className={`rounded-xl shadow-sm p-4 text-white ${
            alerts.lateCount > 0 ? "bg-red-600" : "bg-amber-500"
          }`}
        >
          <h2 className="font-semibold">
            {alerts.lateCount > 0
              ? `🔴 ${alerts.lateCount} delay${alerts.lateCount === 1 ? "" : "s"} on this job`
              : "📋 Pending on this job"}
            {alerts.lateCount > 0 && alerts.todoCount > 0 && (
              <span className="font-normal"> · {alerts.todoCount} pending</span>
            )}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.alerts.map((a, i) => (
              <li
                key={i}
                className={`rounded-lg px-3 py-1.5 ${
                  a.severity === "late" ? "bg-white/15" : "bg-white/10"
                }`}
              >
                {a.text}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs opacity-90">
            Planning targets, promised dates, open issues and missing paperwork for this job.
          </p>
        </section>
      )}

      {/* Stage board */}
      <section>
        <h2 className="font-semibold mb-2 px-1">Stage Board</h2>
        {/* Inspector suggestions for the quality-check field */}
        <datalist id="inspectors">
          <option value={user.name} />
          {employees.map((e) => (
            <option key={e.id} value={e.name} />
          ))}
        </datalist>
        {job.status !== "COMPLETED" && (
          <details className="mb-2">
            <summary className="cursor-pointer text-sm text-blue-700 font-medium px-1 py-1 select-none">
              + New worker not in the list? Add here
            </summary>
            <div className="mt-1">
              <QuickAddEmployee
                units={[{ id: job.unit.id, name: job.unit.name }]}
                alsoRevalidate={`/jobs/${job.id}`}
              />
            </div>
          </details>
        )}
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
          {job.stages.map((stage) => (
            <div
              key={stage.id}
              className={`w-72 shrink-0 snap-start rounded-xl shadow-sm p-3 space-y-3 ${
                stage.status === "ACTIVE"
                  ? "bg-blue-50 ring-2 ring-blue-200"
                  : stage.status === "REWORK"
                  ? "bg-purple-50 ring-2 ring-purple-300"
                  : stage.status === "DONE"
                  ? "bg-green-50"
                  : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <details className="flex-1 min-w-0">
                  <summary className="font-medium leading-tight cursor-pointer select-none list-none">
                    <span className="text-slate-400 text-sm mr-1">{stage.sequence}.</span>
                    {stage.name}
                    <span className="text-slate-300 text-xs ml-1.5" title="Tap for this stage's history">
                      📜
                    </span>
                  </summary>
                  {/* Stage history: every work session, who, how long */}
                  <div className="mt-2 rounded-lg bg-white/70 border border-slate-200 p-2 text-xs space-y-1">
                    {stage.dueAt && <p>📅 Due {formatDate(stage.dueAt)}</p>}
                    {stage.inspectedBy && (
                      <p>
                        ✅ Inspected by {stage.inspectedBy}
                        {stage.inspectedAt && ` on ${formatDate(stage.inspectedAt)}`}
                      </p>
                    )}
                    {stage.reworks.length > 0 && (
                      <p className="text-purple-700">
                        🟣 {stage.reworks.length} rework{stage.reworks.length === 1 ? "" : "s"}
                      </p>
                    )}
                    {(stageHistory.get(stage.id) ?? []).length === 0 && (
                      <p className="text-slate-400">No work sessions yet.</p>
                    )}
                    {(stageHistory.get(stage.id) ?? []).slice(0, 25).map((l, li) => (
                      <p key={li} className="flex justify-between gap-2">
                        <span className="truncate">
                          {l.employee.name}
                          <span className="text-slate-400">
                            {" "}
                            {formatDateTime(l.startedAt)} →{" "}
                            {l.endedAt ? formatDateTime(l.endedAt) : "running"}
                          </span>
                        </span>
                        <span className="whitespace-nowrap text-slate-600">
                          {l.endedAt ? formatDuration(l.startedAt, l.endedAt) : (
                            <LiveDuration since={l.startedAt} />
                          )}
                          {otOverlapMinutes(l.startedAt, l.endedAt ?? new Date()) > 0 && (
                            <span className="text-indigo-700 font-semibold">
                              {" "}🌙 {(otOverlapMinutes(l.startedAt, l.endedAt ?? new Date()) / 60).toFixed(1)}h OT
                            </span>
                          )}
                          {l.endSource === "AUTO_SHIFT_END" && " 🌙"}
                        </span>
                      </p>
                    ))}
                  </div>
                </details>
                <StageStatusBadge status={stage.status} />
              </div>

              {/* What rework is going on — prominent while in rework */}
              {stage.status === "REWORK" && stage.reworks[0] && (
                <div className="rounded-lg bg-purple-100 border border-purple-200 px-2.5 py-2 text-sm text-purple-900">
                  <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-0.5">
                    Rework going on
                  </p>
                  {stage.reworks[0].reason}
                </div>
              )}

              {/* Task due date: write-once for supervisors, admin can correct */}
              {stage.dueAt ? (
                <p
                  className={`text-xs font-medium ${
                    stage.status !== "DONE" && stage.dueAt.getTime() < Date.now()
                      ? "text-red-700"
                      : "text-slate-600"
                  }`}
                >
                  📅 Task due {formatDate(stage.dueAt)}
                  {stage.status !== "DONE" && stage.dueAt.getTime() < Date.now() && " — OVERDUE"}
                  {admin && (
                    <details className="inline-block ml-2 align-middle">
                      <summary className="cursor-pointer text-[10px] text-slate-400 select-none">
                        change
                      </summary>
                      <form action={setStageDue} className="mt-1 flex gap-1">
                        <input type="hidden" name="stageId" value={stage.id} />
                        <input
                          type="date"
                          name="dueAt"
                          required
                          className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                        />
                        <button className="rounded bg-slate-900 text-white px-2 py-1 text-xs">✓</button>
                      </form>
                    </details>
                  )}
                </p>
              ) : (
                stage.status !== "PENDING" &&
                stage.status !== "DONE" &&
                job.status !== "COMPLETED" && (
                  <form action={setStageDue} className="flex items-center gap-1">
                    <input type="hidden" name="stageId" value={stage.id} />
                    <input
                      type="date"
                      name="dueAt"
                      required
                      title="Task due date — cannot be changed once set"
                      className="rounded border border-slate-200 px-1.5 py-1 text-[11px] text-slate-500"
                    />
                    <button className="rounded bg-slate-100 px-1.5 py-1 text-[11px]" title="Set task due date">
                      📅 Set due
                    </button>
                  </form>
                )
              )}

              {/* Start / end time of this stage */}
              {stage.startedAt && (
                <p className="text-xs text-slate-500 leading-snug">
                  Started {formatDateTime(stage.startedAt)}
                  {stage.completedAt ? (
                    <>
                      <br />
                      Finished {formatDateTime(stage.completedAt)} (
                      {formatDuration(stage.startedAt, stage.completedAt)})
                    </>
                  ) : (
                    stage.status === "ACTIVE" && (
                      <>
                        {" · running "}
                        <LiveDuration since={stage.startedAt} />
                      </>
                    )
                  )}
                </p>
              )}

              {/* Total time actually worked on this stage — adds up across
                  every start/pause/restart, idle gaps not counted */}
              {stageWorked.has(stage.id) && (
                <p className="text-xs font-semibold text-blue-800 leading-snug">
                  ⏱ Total worked:{" "}
                  {stage.timeLogs.length > 0 ? (
                    <LiveDuration
                      since={new Date(Date.now() - Math.round(stageWorked.get(stage.id)! * 60000))}
                    />
                  ) : (
                    fmtWorked(stageWorked.get(stage.id)!)
                  )}
                  <span className="font-normal text-slate-400"> · idle not counted</span>
                </p>
              )}

              {/* What this stage has cost — the owner's eyes only */}
              {user.role === "SUPERADMIN" &&
                ((stageLabourCost.get(stage.id) ?? 0) > 0 ||
                  (stageConsumables.get(stage.id) ?? 0) > 0) && (
                <p className="text-xs font-semibold text-emerald-800 leading-snug">
                  💰 {formatMoney((stageLabourCost.get(stage.id) ?? 0) + (stageConsumables.get(stage.id) ?? 0))}
                  <span className="font-normal text-emerald-700">
                    {" "}(labour {formatMoney(stageLabourCost.get(stage.id) ?? 0)}
                    {(stageConsumables.get(stage.id) ?? 0) > 0 && (
                      <> + consumables {formatMoney(stageConsumables.get(stage.id) ?? 0)}*</>
                    )})
                  </span>
                </p>
              )}

              {/* Tests due after this stage */}
              {job.tests.some((t) => t.stage?.id === stage.id) && (
                <div className="flex flex-wrap gap-1">
                  {job.tests
                    .filter((t) => t.stage?.id === stage.id)
                    .map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-sky-100 text-sky-800 whitespace-nowrap"
                      >
                        🧪 {t.name}
                      </span>
                    ))}
                </div>
              )}

              {/* Workers on this stage */}
              {stage.timeLogs.length > 0 && (
                <ul className="space-y-1">
                  {stage.timeLogs.map((log) => (
                    <li
                      key={log.id}
                      className="bg-white rounded-lg px-2 py-1.5 text-sm shadow-sm space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span>
                          {log.employee.name}
                          <span className="text-xs text-slate-400 ml-1">
                            <LiveDuration since={log.startedAt} />
                          </span>
                        </span>
                        <ActionButton
                          action={stopWorker}
                          fields={{ timeLogId: log.id, askShift: "1" }}
                          className="text-xs font-medium text-red-600 rounded-lg px-2.5 py-1.5 hover:bg-red-50 active:bg-red-100"
                          title="Stop this worker's clock"
                          optimistic="Stopping…"
                        >
                          Stop
                        </ActionButton>
                      </div>
                      {/* Evening night plan */}
                      <form action={setShiftPlan} className="flex items-center gap-1">
                        <input type="hidden" name="timeLogId" value={log.id} />
                        <select
                          name="plan"
                          defaultValue={
                            log.plannedEndAt
                              ? shiftPlanLabel(log.plannedEndAt).includes("8 PM")
                                ? "EIGHT_PM"
                                : shiftPlanLabel(log.plannedEndAt).includes("10 PM")
                                ? "TEN_PM"
                                : shiftPlanLabel(log.plannedEndAt).includes("1 AM")
                                ? "ONE_AM"
                                : "FULL_NIGHT"
                              : "NORMAL"
                          }
                          className="flex-1 min-w-0 rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                          style={{ backgroundColor: "#ffffff", color: "#0f172a", colorScheme: "only light" }}
                        >
                          <option value="NORMAL">Normal day</option>
                          <option value="EIGHT_PM">Till 8 PM</option>
                          <option value="TEN_PM">Till 10 PM</option>
                          <option value="ONE_AM">Till 1 AM</option>
                          <option value="FULL_NIGHT">Full night (2:30 AM, +4h OT)</option>
                        </select>
                        <button className="rounded bg-slate-100 px-1.5 py-1 text-[11px]" title="Save plan">
                          ✓
                        </button>
                        {log.plannedEndAt && (
                          <span className="text-[10px] font-semibold text-indigo-700 whitespace-nowrap">
                            🌙 {shiftPlanLabel(log.plannedEndAt)}
                          </span>
                        )}
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {/* One-tap assign */}
              {job.status !== "COMPLETED" && (
                <form action={assignWorker} className="flex gap-1">
                  <input type="hidden" name="stageId" value={stage.id} />
                  <SearchSelect
                    name="employeeId"
                    required
                    className="flex-1 min-w-0"
                    placeholder="Assign worker — type to search…"
                    options={workerGroups.flatMap((g) =>
                      g.list.map((e) => ({
                        value: e.id,
                        label: `${e.name} (${e.skill})`,
                        group: g.label,
                      }))
                    )}
                  />
                  <PendingSubmit
                    className="rounded-lg bg-blue-600 text-white px-3.5 py-1.5 text-sm active:bg-blue-700 disabled:opacity-60"
                    busy="…"
                  >
                    ➜
                  </PendingSubmit>
                </form>
              )}

              {/* Stage status controls */}
              <div className="flex flex-wrap gap-1.5">
                {(stage.status === "PENDING" || stage.status === "PAUSED") &&
                  job.status !== "COMPLETED" && (
                  <form action={setStageStatus} className="flex items-center gap-1.5 flex-wrap">
                    <input type="hidden" name="stageId" value={stage.id} />
                    <input type="hidden" name="status" value="ACTIVE" />
                    {stage.status === "PENDING" && !stage.dueAt && (
                      <input
                        type="date"
                        name="dueAt"
                        title="Task due date (optional — cannot be changed later)"
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600"
                      />
                    )}
                    <PendingSubmit
                      className="rounded-lg px-3 py-1.5 text-sm font-medium bg-blue-600 text-white active:bg-blue-700 disabled:opacity-60"
                      busy={stage.status === "PAUSED" ? "Resuming…" : "Starting…"}
                    >
                      {stage.status === "PAUSED" ? "Resume" : "Start"}
                    </PendingSubmit>
                  </form>
                )}
                {(stage.status === "ACTIVE" || stage.status === "REWORK") && (
                  <ActionButton
                    action={setStageStatus}
                    fields={{ stageId: stage.id, status: "PAUSED" }}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium bg-amber-500 text-white active:bg-amber-600 disabled:opacity-60"
                    optimistic="Pausing…"
                  >
                    Pause
                  </ActionButton>
                )}
              </div>

              {/* Done = quality check: inspector name is compulsory */}
              {(stage.status === "ACTIVE" || stage.status === "REWORK") && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-green-700 select-none">
                    ✓ Mark Done (quality check)
                  </summary>
                  <form action={completeStage} className="mt-1.5 space-y-1.5">
                    <input type="hidden" name="stageId" value={stage.id} />
                    <input
                      name="inspectedBy"
                      required
                      list="inspectors"
                      placeholder="Inspected / checked by (compulsory)"
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                    <PendingSubmit
                      className="rounded-lg px-3 py-1.5 text-sm font-medium bg-green-600 text-white active:bg-green-700 disabled:opacity-60"
                      busy="Completing…"
                    >
                      Confirm Done
                    </PendingSubmit>
                  </form>
                </details>
              )}

              {/* Who inspected a finished stage */}
              {stage.status === "DONE" && stage.inspectedBy && (
                <p className="text-xs text-green-800 bg-green-100 rounded-lg px-2.5 py-1.5">
                  ✓ Inspected by <b>{stage.inspectedBy}</b>
                  {stage.inspectedAt && <> — {formatDateTime(stage.inspectedAt)}</>}
                </p>
              )}

              {/* Rework: reason is compulsory; on a Done stage it also reopens */}
              {stage.status !== "PENDING" && job.status !== "COMPLETED" && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-purple-700 select-none">
                    🔁 Rework{stage.status === "DONE" ? " (reopens stage)" : ""}
                  </summary>
                  <form action={recordRework} className="mt-1.5 space-y-1.5">
                    <input type="hidden" name="stageId" value={stage.id} />
                    <textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Reason for rework (compulsory)"
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                    <button className="rounded-lg px-3 py-1.5 text-sm font-medium bg-purple-600 text-white active:bg-purple-700">
                      Record rework
                    </button>
                  </form>
                </details>
              )}

              {/* Rework history on this stage */}
              {stage.reworks.length > 0 && (
                <ul className="space-y-1">
                  {stage.reworks.map((rw) => (
                    <li
                      key={rw.id}
                      className="text-xs bg-purple-50 text-purple-900 rounded-lg px-2 py-1.5"
                    >
                      🔁 {rw.reason}
                      <span className="text-purple-400">
                        {" "}— {rw.raisedBy.name}, {formatDateTime(rw.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {/* Add extra stage */}
          {admin && job.status !== "COMPLETED" && (
            <form
              action={addStage}
              className="w-72 shrink-0 rounded-xl border-2 border-dashed border-slate-300 p-3 flex flex-col gap-2 justify-center"
            >
              <input type="hidden" name="jobId" value={job.id} />
              <input
                name="name"
                required
                placeholder="Extra stage name"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button className="rounded-lg bg-slate-900 text-white py-1.5 text-sm">
                + Add stage
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Timesheet calendar: stage-wise hours per day, plan targets overlaid */}
      <section className="bg-white rounded-xl shadow-sm p-4" id="calendar">
        <h2 className="font-semibold mb-3">📅 Timesheet calendar</h2>
        <JobCalendar
          jobId={job.id}
          month={m}
          stageId={stageParam}
          basePath={`/jobs/${job.id}`}
          extraParams={{}}
        />
      </section>

      {/* Documents: drawings & bill of material */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Documents</h2>
        {job.drawingPending && (
          <p className="mb-3 rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-sm text-amber-900">
            <b>📐 Drawing pending.</b> A previous job&apos;s drawing was not confirmed for this
            job, so nothing was attached. Upload the updated drawing before work goes further.
          </p>
        )}
        {job.attachments.length === 0 && (
          <p className="text-sm text-slate-400 mb-3">
            No drawings or BOM uploaded yet.
          </p>
        )}
        <ul className="space-y-1.5 mb-4">
          {job.attachments.map((att) => (
            <li
              key={att.id}
              className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm"
            >
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800 whitespace-nowrap">
                {ATTACHMENT_KIND_LABELS[att.kind]}
              </span>
              <a
                href={`/api/attachments/${att.id}`}
                className="font-medium text-blue-700 hover:underline break-all"
              >
                {att.filename}
              </a>
              <span className="text-xs text-slate-400">
                {formatFileSize(att.size)} · {att.uploadedBy.name} ·{" "}
                {formatDateTime(att.createdAt)}
              </span>
              {att.sourceJobId && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] bg-slate-200 text-slate-700"
                  title="Reused from an earlier job after the supervisor confirmed nothing had changed"
                >
                  ♻️ reused
                </span>
              )}
              {admin && (
                <form action={deleteAttachment} className="ml-auto">
                  <input type="hidden" name="attachmentId" value={att.id} />
                  <button className="text-xs text-red-600 hover:underline">
                    Delete
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {/* Add a drawing: upload a new one, or reuse a past job's after
            confirming nothing has changed. Supervisors can do this — they are
            the ones the morning list asks for drawings. */}
        <DrawingPicker jobId={job.id} jobName={job.description} />
      </section>

      {/* Testing requirements */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Testing</h2>
        {job.tests.length === 0 && (
          <p className="text-sm text-slate-400 mb-3">No tests recorded for this job.</p>
        )}
        <ul className="space-y-1.5 mb-4">
          {job.tests.map((test) => (
            <li
              key={test.id}
              className="flex flex-wrap items-center gap-2 bg-sky-50 rounded-lg px-3 py-2 text-sm"
            >
              <span className="font-medium text-sky-900">🧪 {test.name}</span>
              <span className="text-xs text-slate-500">
                {test.stage ? `stage ${test.stage.sequence} on the board` : "final / whole job"}
              </span>
              {admin && (
                <form action={deleteJobTest} className="ml-auto">
                  <input type="hidden" name="testId" value={test.id} />
                  <button className="text-xs text-red-600 hover:underline">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {job.status !== "COMPLETED" && (
          <form action={addJobTest} className="flex flex-wrap gap-2 items-center">
            <input type="hidden" name="jobId" value={job.id} />
            <input
              name="name"
              required
              list="test-types"
              placeholder="Add test…"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-44"
            />
            <datalist id="test-types">
              <option value="DP Test" />
              <option value="RT Test" />
              <option value="Hydro Test" />
              <option value="Kerosene / Leak Test" />
              <option value="UT Test" />
              <option value="Dimension Inspection" />
              <option value="Final Painting Inspection" />
              <option value="Final Inspection" />
            </datalist>
            <select name="stageId" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Final (whole job)</option>
              {job.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  after {s.sequence}. {s.name}
                </option>
              ))}
            </select>
            <button className={`${btn} bg-sky-600 text-white hover:bg-sky-700`}>
              + Add test
            </button>
          </form>
        )}
      </section>

      {/* Issues */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Issues</h2>
        {openIssues.length === 0 && (
          <p className="text-sm text-slate-400 mb-3">No open issues.</p>
        )}
        <ul className="space-y-2 mb-4">
          {job.issues.map((issue) => (
            <li
              key={issue.id}
              className={`rounded-lg px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2 ${
                issue.status === "OPEN" ? "bg-red-50" : "bg-slate-50 text-slate-500"
              }`}
            >
              <div>
                <IssueBadge type={issue.type} />
                <span className="ml-2">{issue.description}</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  Raised by {issue.raisedBy.name} · {formatDateTime(issue.createdAt)}
                  {issue.dueAt && (
                    <span
                      className={
                        issue.status === "OPEN" && issue.dueAt.getTime() < Date.now()
                          ? " text-red-600 font-medium"
                          : ""
                      }
                    >
                      {" "}· resolve by {formatDate(issue.dueAt)}
                    </span>
                  )}
                  {issue.status === "RESOLVED" &&
                    ` · Resolved by ${issue.resolvedBy?.name ?? "—"}`}
                </p>
              </div>
              {issue.status === "OPEN" && (
                <form action={resolveIssue}>
                  <input type="hidden" name="issueId" value={issue.id} />
                  <button className={`${btn} bg-green-100 text-green-800 hover:bg-green-200`}>
                    Resolve
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {/* One-tap raise issue */}
        <form action={raiseIssue} className="flex flex-wrap gap-2 items-center">
          <input type="hidden" name="jobId" value={job.id} />
          <select name="type" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="MATERIAL_SHORTAGE">Material Shortage</option>
            <option value="LABOUR_SHORTAGE">Labour Shortage</option>
            <option value="OTHER">Other</option>
          </select>
          <input
            name="description"
            required
            placeholder="What's the problem?"
            className="flex-1 min-w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-slate-500 whitespace-nowrap">Resolve by</span>
            <input
              name="dueAt"
              type="date"
              required
              defaultValue={istDateInput(1)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
            />
          </label>
          <button className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
            🚩 Raise Issue
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-1.5">
          Raising an issue sends a WhatsApp to Jagdish and the owner straight away.
        </p>
      </section>

      {/* Time log */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Time Log (latest 50)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-2 py-2">Worker</th>
                <th className="px-2 py-2">Stage</th>
                <th className="px-2 py-2">Start</th>
                <th className="px-2 py-2">End</th>
                <th className="px-2 py-2">Duration</th>
                <th className="px-2 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {job.timeLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-2 py-2 whitespace-nowrap">{log.employee.name}</td>
                  <td className="px-2 py-2">{log.stage?.name ?? "—"}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{formatDateTime(log.startedAt)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {log.endedAt ? (
                      formatDateTime(log.endedAt)
                    ) : (
                      <span className="text-blue-700 font-medium">active</span>
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {log.endedAt ? formatDuration(log.startedAt, log.endedAt) : (
                      <LiveDuration since={log.startedAt} />
                    )}
                    {log.endedAt && otOverlapMinutes(log.startedAt, log.endedAt) > 0 && (
                      <span className="ml-1 text-xs font-semibold text-indigo-700">
                        🌙 {(otOverlapMinutes(log.startedAt, log.endedAt) / 60).toFixed(1)}h OT
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {log.startSource === "AUTO_ATTENDANCE"
                      ? "auto-resume"
                      : `by ${log.startedBy?.name ?? "—"}`}
                    {log.endedAt &&
                      (log.endSource === "AUTO_ATTENDANCE"
                        ? " / auto-logout"
                        : log.endSource === "AUTO_SHIFT_END"
                        ? " / night-plan cutoff"
                        : ` / ${log.endedBy?.name ?? "manual"}`)}
                  </td>
                </tr>
              ))}
              {job.timeLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-slate-400">
                    No time logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
