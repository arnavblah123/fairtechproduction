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
import { assignGeneralDuty, stopWorker } from "@/lib/actions/stages";
import type { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const JOB_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] as const;

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

  // Workers currently on general duties (material handling / dispatch).
  const [dutyLogs, unitWorkers] = await Promise.all([
    db.timeLog.findMany({
      where: {
        endedAt: null,
        activity: { in: ["MATERIAL_HANDLING", "DISPATCH"] },
        unitId: { in: units.map((u) => u.id) },
      },
      include: { employee: true },
      orderBy: { startedAt: "asc" },
    }),
    db.employee.findMany({
      where: { active: true, primaryUnitId: { in: units.map((u) => u.id) } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, skill: true, primaryUnitId: true },
    }),
  ]);

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
            const unitJobs = jobs.filter((j) => j.unitId === unit.id);
            return (
              <section key={unit.id} className="bg-white rounded-xl shadow-sm">
                <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">{unit.name}</h2>
                    <p className="text-xs text-slate-500">{unit.location}</p>
                  </div>
                  <span className="text-sm text-slate-500">
                    {unitJobs.length} job{unitJobs.length === 1 ? "" : "s"}
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
                                    on {log.stage?.name ?? "—"}
                                  </span>
                                </span>
                                <span className="font-medium">
                                  <LiveDuration since={log.startedAt} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Link>
                    );
                  })}
                </div>

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
                          <span className="font-medium">
                            <LiveDuration since={log.startedAt} />
                          </span>
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
                    </select>
                    <button className="rounded-lg bg-teal-600 text-white px-2.5 text-xs">
                      Go
                    </button>
                  </form>
                </div>
              </section>
            );
          })}
      </div>
    </div>
  );
}
