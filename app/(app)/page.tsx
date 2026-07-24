import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope } from "@/lib/permissions";
import {
  JobStatusBadge,
  IssueBadge,
  PriorityBadge,
} from "@/components/badges";
import { LiveDuration } from "@/components/live-duration";
import { formatDate, formatDateTime, jobCode, ACTIVITY_LABELS } from "@/lib/format";
import { assignGeneralDuty, assignDispatchWorker, stopWorker } from "@/lib/actions/stages";
import { setJobStatus, setJobRank } from "@/lib/actions/jobs";
import { isAdmin } from "@/lib/permissions";
import { startCrane, stopCrane } from "@/lib/actions/crane";
import { setShiftPlan } from "@/lib/actions/stages";
import { closeOverdueShifts, shiftPlanLabel } from "@/lib/shift";
import { workedByStage, fmtWorked } from "@/lib/idle";
import type { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const JOB_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "READY_TO_DISPATCH",
  "COMPLETED",
] as const;

// Live overview: units side by side, jobs with status, current workers with
// running durations, open-issue flags. Filter by unit / client / status.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; client?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { unit: unitFilter, client: clientFilter, status: statusFilter } =
    await searchParams;

  // Lazy sweep: stop any clock whose night-plan cutoff has passed (the
  // scheduled cron also does this at 10 PM / 2:30 AM).
  await closeOverdueShifts();

  const units = await db.unit.findMany({
    where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
    orderBy: { name: "asc" },
  });

  const jobs = await db.job.findMany({
    where: {
      ...unitScope(user),
      ...(unitFilter ? { unitId: unitFilter } : {}),
      ...(clientFilter
        ? { clientName: { contains: clientFilter, mode: "insensitive" } }
        : {}),
      ...(statusFilter
        ? { status: statusFilter as JobStatus }
        : { status: { not: "COMPLETED" } }),
    },
    include: {
      stages: { orderBy: { sequence: "asc" } },
      issues: { where: { status: "OPEN" } },
      timeLogs: {
        where: { endedAt: null },
        include: { employee: true, stage: true },
      },
    },
    orderBy: [{ priority: "desc" }, { expectedCompletion: "asc" }],
  });

  // Workers currently on general duties, plus running outside-crane clocks.
  const [dutyLogs, craneLogs, unitWorkers] = await Promise.all([
    db.timeLog.findMany({
      where: {
        endedAt: null,
        activity: { not: "STAGE" },
        unitId: { in: units.map((u) => u.id) },
      },
      include: { employee: true },
      orderBy: { startedAt: "asc" },
    }),
    db.craneLog.findMany({
      where: { endedAt: null, unitId: { in: units.map((u) => u.id) } },
      orderBy: { startedAt: "asc" },
    }),
    db.employee.findMany({
      where: { active: true, primaryUnitId: { in: units.map((u) => u.id) } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, skill: true, primaryUnitId: true },
    }),
  ]);

  // Total actively-worked time per stage (all sessions, idle gaps excluded)
  // so a restarted stage still shows its full running total.
  const allStageLogs = await db.timeLog.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, stageId: { not: null } },
    select: { stageId: true, startedAt: true, endedAt: true },
  });
  const stageWorked = workedByStage(allStageLogs);

  const activeWorkerCount = new Set([
    ...jobs.flatMap((j) => j.timeLogs.map((t) => t.employeeId)),
    ...dutyLogs.map((l) => l.employeeId),
  ]).size;
  const openIssueCount = jobs.reduce((n, j) => n + j.issues.length, 0);

  // Jobs in progress with nobody clocked on = idle right now. "Since" is the
  // last time anyone stopped work (or the active stage start if never worked).
  const idleJobs = jobs.filter(
    (j) => j.status === "IN_PROGRESS" && j.timeLogs.length === 0
  );
  const lastEnded = idleJobs.length
    ? await db.timeLog.groupBy({
        by: ["jobId"],
        where: { jobId: { in: idleJobs.map((j) => j.id) } },
        _max: { endedAt: true },
      })
    : [];
  const idleSince = new Map<string, Date>();
  for (const job of idleJobs) {
    const ended = lastEnded.find((g) => g.jobId === job.id)?._max.endedAt;
    const fallback =
      job.stages.find((s) => s.status === "ACTIVE" || s.status === "REWORK")?.startedAt ??
      job.updatedAt;
    idleSince.set(job.id, ended ?? fallback);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Production Dashboard</h1>
        <div className="flex gap-2 text-sm">
          <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
            <b>{jobs.length}</b> jobs shown
          </span>
          <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
            <b>{activeWorkerCount}</b> working now
          </span>
          <span
            className={`rounded-lg px-3 py-1.5 shadow-sm ${
              openIssueCount > 0 ? "bg-red-100 text-red-800" : "bg-white"
            }`}
          >
            <b>{openIssueCount}</b> open issues
          </span>
        </div>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-2 items-end bg-white rounded-xl shadow-sm p-3">
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">Unit</span>
          <select
            name="unit"
            defaultValue={unitFilter ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">Client</span>
          <input
            name="client"
            defaultValue={clientFilter ?? ""}
            placeholder="Search client…"
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">Status</span>
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            className="rounded-lg border border-slate-300 px-2 py-1.5"
          >
            <option value="">All active (default)</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5 text-sm">
          Filter
        </button>
      </form>

      {/* Units side by side */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 items-start">
        {units
          .filter((u) => !unitFilter || u.id === unitFilter)
          .map((unit) => {
            const allUnitJobs = jobs.filter((j) => j.unitId === unit.id);
            const unitJobs = allUnitJobs.filter(
              (j) => j.status !== "READY_TO_DISPATCH" && j.status !== "NOT_STARTED"
            );
            const dispatchJobs = allUnitJobs.filter((j) => j.status === "READY_TO_DISPATCH");
            const upcomingJobs = allUnitJobs
              .filter((j) => j.status === "NOT_STARTED")
              .sort(
                (a, b) =>
                  a.priorityRank - b.priorityRank ||
                  a.expectedCompletion.getTime() - b.expectedCompletion.getTime()
              );
            return (
              <section key={unit.id} className="bg-white rounded-xl shadow-sm">
                <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">{unit.name}</h2>
                    <p className="text-xs text-slate-500">{unit.location}</p>
                  </div>
                  <span className="text-sm text-slate-500">
                    {allUnitJobs.length} job{allUnitJobs.length === 1 ? "" : "s"}
                  </span>
                </header>
                <div className="divide-y divide-slate-100">
                  {unitJobs.length === 0 && (
                    <p className="px-4 py-6 text-sm text-slate-400 text-center">
                      No jobs match.
                    </p>
                  )}
                  {unitJobs.map((job) => {
                    const activeStage = job.stages.find(
                      (s) => s.status === "ACTIVE" || s.status === "REWORK"
                    );
                    return (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        className="block px-4 py-3 hover:bg-slate-50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">
                              {job.clientName}
                              <span className="text-slate-400 font-normal text-sm ml-2">
                                {jobCode(job.jobNumber)}
                              </span>
                            </p>
                            <p className="text-sm text-slate-500">{job.description}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <JobStatusBadge status={job.status} />
                            {job.priority && <PriorityBadge />}
                            {job.issues.length > 0 && (
                              <IssueBadge count={job.issues.length} />
                            )}
                            {idleSince.has(job.id) && (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-800">
                                Idle <LiveDuration since={idleSince.get(job.id)!} />
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Due {formatDate(job.expectedCompletion)}
                          {job.status === "READY_TO_DISPATCH" && job.estimatedDispatchAt && (
                            <span className="text-cyan-700 font-medium">
                              {" "}· 🚚 dispatch est. {formatDate(job.estimatedDispatchAt)}
                            </span>
                          )}
                          {activeStage && (
                            <>
                              {" · "}
                              <span className="text-blue-700 font-medium">
                                {activeStage.name}
                              </span>
                              {activeStage.startedAt && (
                                <span>
                                  {" "}since {formatDateTime(activeStage.startedAt)}
                                </span>
                              )}
                              {stageWorked.has(activeStage.id) && (
                                <span className="text-blue-700">
                                  {" "}· ⏱ {fmtWorked(stageWorked.get(activeStage.id)!)} worked
                                </span>
                              )}
                            </>
                          )}
                        </p>
                        {job.timeLogs.length > 0 && (
                          <ul className="mt-2 space-y-0.5">
                            {job.timeLogs.map((log) => (
                              <li
                                key={log.id}
                                className="text-xs bg-blue-50 text-blue-900 rounded px-2 py-1 flex justify-between"
                              >
                                <span>
                                  {log.employee.name}{" "}
                                  <span className="text-blue-600">
                                    on {log.stage?.name ?? ACTIVITY_LABELS[log.activity] ?? "—"}
                                  </span>
                                </span>
                                <span className="text-right font-medium">
                                  <LiveDuration since={log.startedAt} />
                                  {log.stageId && stageWorked.has(log.stageId) && (
                                    <span className="block text-[10px] font-normal text-blue-500 whitespace-nowrap">
                                      stage total{" "}
                                      <LiveDuration
                                        since={
                                          new Date(
                                            Date.now() -
                                              Math.round(stageWorked.get(log.stageId)! * 60000)
                                          )
                                        }
                                      />
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Link>
                    );
                  })}
                </div>

                {/* Upcoming: created but not started, ranked by priority */}
                {upcomingJobs.length > 0 && (
                  <div className="border-t-2 border-amber-200 bg-amber-50/50 px-4 py-3 space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      ⏭ Upcoming — priority order
                    </p>
                    {upcomingJobs.map((job, i) => (
                      <div
                        key={job.id}
                        className="bg-white rounded-lg px-2.5 py-2 shadow-sm flex flex-wrap items-center gap-2 text-sm"
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-white text-xs font-bold">
                          {i + 1}
                        </span>
                        <Link href={`/jobs/${job.id}`} className="font-medium hover:underline min-w-0">
                          {job.clientName}
                          <span className="text-slate-400 font-normal text-xs ml-1">
                            {jobCode(job.jobNumber)}
                          </span>
                        </Link>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          due {formatDate(job.expectedCompletion)}
                        </span>
                        <form action={setJobRank} className="ml-auto flex items-center gap-1">
                          <input type="hidden" name="jobId" value={job.id} />
                          <input
                            type="number"
                            name="rank"
                            min={1}
                            max={999}
                            defaultValue={job.priorityRank}
                            title="Priority rank — lower starts first"
                            className="w-14 rounded border border-amber-200 px-1.5 py-1 text-xs"
                          />
                          <button className="rounded bg-amber-600 text-white px-1.5 py-1 text-xs" title="Save rank">
                            ✓
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                )}

                {/* Ready to Dispatch: finished jobs awaiting the truck */}
                {dispatchJobs.length > 0 && (
                  <div className="border-t-2 border-cyan-200 bg-cyan-50/60 px-4 py-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
                      🚚 Ready to Dispatch
                    </p>
                    {dispatchJobs.map((job) => {
                      const dispatchWorkers = job.timeLogs.filter((l) => !l.stage);
                      return (
                        <div key={job.id} className="bg-white rounded-lg p-2.5 space-y-1.5 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <Link href={`/jobs/${job.id}`} className="font-medium text-sm hover:underline">
                              {job.clientName}
                              <span className="text-slate-400 font-normal text-xs ml-1">
                                {jobCode(job.jobNumber)}
                              </span>
                            </Link>
                            {job.estimatedDispatchAt && (
                              <span
                                className={`text-xs whitespace-nowrap font-medium ${
                                  job.estimatedDispatchAt.getTime() + 86400000 < Date.now()
                                    ? "text-red-700"
                                    : "text-cyan-700"
                                }`}
                              >
                                est. {formatDate(job.estimatedDispatchAt)}
                              </span>
                            )}
                          </div>
                          {dispatchWorkers.map((log) => (
                            <div
                              key={log.id}
                              className="flex items-center justify-between text-xs bg-cyan-50 text-cyan-900 rounded px-2 py-1"
                            >
                              <span>{log.employee.name} <span className="text-cyan-600">loading</span></span>
                              <span className="flex items-center gap-2">
                                <span className="font-semibold">
                                  <LiveDuration since={log.startedAt} />
                                </span>
                                <form action={stopWorker}>
                                  <input type="hidden" name="timeLogId" value={log.id} />
                                  <button className="text-red-600 hover:underline">Stop</button>
                                </form>
                              </span>
                            </div>
                          ))}
                          <div className="flex gap-1.5">
                            <form action={assignDispatchWorker} className="flex gap-1.5 flex-1 min-w-0">
                              <input type="hidden" name="jobId" value={job.id} />
                              <select
                                name="employeeId"
                                required
                                defaultValue=""
                                className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                              >
                                <option value="" disabled>
                                  Worker for dispatch…
                                </option>
                                {unitWorkers
                                  .filter((w) => w.primaryUnitId === unit.id)
                                  .map((w) => (
                                    <option key={w.id} value={w.id}>
                                      {w.name} ({w.skill})
                                    </option>
                                  ))}
                              </select>
                              <button className="rounded-lg bg-cyan-600 text-white px-2.5 text-xs">
                                Go
                              </button>
                            </form>
                            {isAdmin(user) && (
                              <form action={setJobStatus}>
                                <input type="hidden" name="jobId" value={job.id} />
                                <input type="hidden" name="status" value="COMPLETED" />
                                <button
                                  className="rounded-lg bg-green-600 text-white px-2.5 py-1.5 text-xs font-medium whitespace-nowrap"
                                  title="Job has left the factory — removes it from here; all data stays in History"
                                >
                                  Dispatched ✓
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* General duties: material handling / dispatch */}
                <div className="border-t border-slate-100 px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    General duties
                  </p>
                  {dutyLogs
                    .filter((l) => l.unitId === unit.id)
                    .map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between text-xs bg-teal-50 text-teal-900 rounded px-2 py-1"
                      >
                        <span>
                          {log.employee.name}{" "}
                          <span className="text-teal-600">
                            on {ACTIVITY_LABELS[log.activity] ?? log.activity}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {log.plannedEndAt && (
                            <span className="text-[10px] font-semibold text-indigo-700 whitespace-nowrap">
                              🌙 {shiftPlanLabel(log.plannedEndAt)}
                            </span>
                          )}
                          <span className="font-medium">
                            <LiveDuration since={log.startedAt} />
                          </span>
                          <form action={setShiftPlan} className="flex items-center gap-1">
                            <input type="hidden" name="timeLogId" value={log.id} />
                            <select
                              name="plan"
                              defaultValue={
                                log.plannedEndAt
                                  ? shiftPlanLabel(log.plannedEndAt).includes("10 PM")
                                    ? "TEN_PM"
                                    : "FULL_NIGHT"
                                  : "NORMAL"
                              }
                              className="rounded border border-teal-200 px-1 py-0.5 text-[10px] text-teal-800 bg-white"
                            >
                              <option value="NORMAL">Normal</option>
                              <option value="TEN_PM">Till 10 PM</option>
                              <option value="FULL_NIGHT">Full night</option>
                            </select>
                            <button className="text-teal-700" title="Save plan">✓</button>
                          </form>
                          <form action={stopWorker}>
                            <input type="hidden" name="timeLogId" value={log.id} />
                            <button className="text-red-600 hover:underline" title="Stop">
                              Stop
                            </button>
                          </form>
                        </span>
                      </div>
                    ))}
                  <form action={assignGeneralDuty} className="flex gap-1.5">
                    <input type="hidden" name="unitId" value={unit.id} />
                    <select
                      name="employeeId"
                      required
                      defaultValue=""
                      className="flex-1 min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      <option value="" disabled>
                        Put worker on…
                      </option>
                      {unitWorkers
                        .filter((w) => w.primaryUnitId === unit.id)
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} ({w.skill})
                          </option>
                        ))}
                    </select>
                    <select
                      name="activity"
                      className="rounded-lg border border-slate-300 px-1.5 py-1.5 text-xs"
                    >
                      <option value="MATERIAL_HANDLING">Material Handling</option>
                      <option value="DISPATCH">Dispatch</option>
                      <option value="PLATE_CUTTING">Plate Cutting</option>
                      <option value="STRUCTURAL_CUTTING">Structural Cutting</option>
                    </select>
                    <button className="rounded-lg bg-teal-600 text-white px-2.5 text-xs">
                      Go
                    </button>
                  </form>

                  {/* Outside crane clock */}
                  {craneLogs
                    .filter((c) => c.unitId === unit.id)
                    .map((crane) => (
                      <div
                        key={crane.id}
                        className="flex items-center justify-between text-xs bg-orange-50 text-orange-900 rounded px-2 py-1.5"
                      >
                        <span>
                          🏗 Outside crane{" "}
                          <span className="text-orange-600">
                            ({crane.purpose === "DISPATCH" ? "Dispatch" : "Material Handling"}
                            {crane.note ? ` — ${crane.note}` : ""})
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold">
                            <LiveDuration since={crane.startedAt} />
                          </span>
                          <form action={stopCrane}>
                            <input type="hidden" name="craneLogId" value={crane.id} />
                            <button className="text-red-600 hover:underline">Stop</button>
                          </form>
                        </span>
                      </div>
                    ))}
                  <details>
                    <summary className="cursor-pointer text-xs text-orange-700 font-medium select-none">
                      🏗 Called an outside crane?
                    </summary>
                    <form action={startCrane} className="mt-1.5 flex flex-wrap gap-1.5">
                      <input type="hidden" name="unitId" value={unit.id} />
                      <select
                        name="purpose"
                        className="rounded-lg border border-slate-300 px-1.5 py-1.5 text-xs"
                      >
                        <option value="MATERIAL_HANDLING">For Material Handling</option>
                        <option value="DISPATCH">For Dispatch</option>
                      </select>
                      <input
                        name="note"
                        placeholder="Note (optional)"
                        className="flex-1 min-w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                      />
                      <button className="rounded-lg bg-orange-600 text-white px-2.5 py-1.5 text-xs font-medium">
                        Start crane clock
                      </button>
                    </form>
                  </details>
                </div>
              </section>
            );
          })}
      </div>
    </div>
  );
}
