import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope, allowPurchaseHr } from "@/lib/permissions";
import { jobCode, formatDate } from "@/lib/format";
import { setStagePlan, addStageWorker, removeStageWorker } from "@/lib/actions/roadmap";
import { SearchSelect } from "@/components/search-select";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

// Manufacturing Road Map (FTE/PRD/RM) — the same sheet the shop floor uses:
// activities down the side, days across the top, a yellow planned bar and a
// green actual bar per activity, Sundays greyed as the weekly off. The plan
// is the owner's; the actual bars are drawn from real clocked work, and the
// labour plan below shows who is meant to be on what, day by day.

const DAY = 86400000;
const IST_MS = 5.5 * 3600e3;

// IST calendar-day string for any instant, and the reverse.
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayStart = (s: string) => new Date(new Date(s).getTime() - IST_MS);

function daysBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let t = new Date(fromDay).getTime();
  const end = new Date(toDay).getTime();
  while (t <= end && out.length < 200) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += DAY;
  }
  return out;
}

// Monday-start week index, for the "week 1 / week 2 …" header groups.
function weekKey(day: string): string {
  const d = new Date(day);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}
const isSunday = (day: string) => new Date(day).getUTCDay() === 0;
const dayNum = (day: string) => Number(day.slice(8, 10));
const monthShort = (day: string) =>
  new Date(day).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const user = await requireUser();
  allowPurchaseHr(user);
  const owner = user.role === "SUPERADMIN";
  const { job: jobParam } = await searchParams;

  const jobs = await db.job.findMany({
    where: { status: { notIn: ["COMPLETED"] }, ...unitScope(user) },
    select: {
      id: true,
      jobNumber: true,
      description: true,
      clientName: true,
      unit: { select: { code: true } },
    },
    orderBy: { jobNumber: "desc" },
    take: 200,
  });

  const jobId = jobParam ?? jobs[0]?.id;
  const job = jobId
    ? await db.job.findUnique({
        where: { id: jobId },
        include: {
          unit: { select: { id: true, name: true, code: true } },
          stages: {
            orderBy: { sequence: "asc" },
            include: {
              planWorkers: {
                include: { employee: { select: { id: true, name: true, skill: true } } },
              },
            },
          },
        },
      })
    : null;

  if (!job) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">🗺️ Manufacturing Road Map</h1>
        <p className="text-slate-400">No running jobs to plan yet.</p>
      </div>
    );
  }

  // Actual bars: a day is green if any work was clocked on that stage that day.
  const logs = await db.timeLog.findMany({
    where: { jobId: job.id, stageId: { not: null } },
    select: { stageId: true, startedAt: true, endedAt: true, employeeId: true },
  });
  const now = new Date();
  const actualDays = new Map<string, Set<string>>(); // stageId → IST days worked
  for (const l of logs) {
    const set = actualDays.get(l.stageId!) ?? new Set<string>();
    let t = l.startedAt.getTime();
    const end = Math.min((l.endedAt ?? now).getTime(), now.getTime());
    // Walk the calendar days the session spans (a night shift covers two).
    while (t <= end) {
      set.add(istDay(new Date(t)));
      const nextMidnight = dayStart(istDay(new Date(t))).getTime() + DAY;
      t = nextMidnight;
    }
    actualDays.set(l.stageId!, set);
  }

  // Window: everything the plan and the real work touch, padded to whole weeks.
  const marks: string[] = [istDay(job.expectedCompletion)];
  for (const s of job.stages) {
    if (s.plannedStart) marks.push(istDay(s.plannedStart));
    if (s.plannedEnd) marks.push(istDay(s.plannedEnd));
    for (const d of actualDays.get(s.id) ?? []) marks.push(d);
  }
  marks.push(istDay(now));
  const minDay = marks.reduce((a, b) => (a < b ? a : b));
  const maxDay = marks.reduce((a, b) => (a > b ? a : b));
  const firstDay = weekKey(minDay);
  const lastWeek = weekKey(maxDay);
  const lastDay = new Date(new Date(lastWeek).getTime() + 6 * DAY).toISOString().slice(0, 10);
  const days = daysBetween(firstDay, lastDay);

  // Week header groups
  const weekGroups: { key: string; label: string; span: number }[] = [];
  for (const d of days) {
    const k = weekKey(d);
    const last = weekGroups[weekGroups.length - 1];
    if (last && last.key === k) last.span++;
    else weekGroups.push({ key: k, label: `week ${weekGroups.length + 1}`, span: 1 });
  }

  const today = istDay(now);
  const inPlan = (s: (typeof job.stages)[0], day: string) =>
    !!s.plannedStart &&
    day >= istDay(s.plannedStart) &&
    day <= istDay(s.plannedEnd ?? s.plannedStart);

  // Labour plan: every worker planned on this job, and their days from the
  // activities they are assigned to. Clashes with other jobs are flagged.
  const plannedEmployeeIds = [
    ...new Set(job.stages.flatMap((s) => s.planWorkers.map((w) => w.employeeId))),
  ];
  const otherAssignments = plannedEmployeeIds.length
    ? await db.stagePlanWorker.findMany({
        where: {
          employeeId: { in: plannedEmployeeIds },
          stage: { jobId: { not: job.id } },
        },
        include: {
          stage: {
            select: {
              name: true,
              plannedStart: true,
              plannedEnd: true,
              job: { select: { id: true, jobNumber: true, description: true } },
            },
          },
        },
      })
    : [];

  type LabourRow = {
    id: string;
    name: string;
    skill: string;
    byDay: Map<string, { activity: string; clash?: string }>;
  };
  const labourRows = new Map<string, LabourRow>();
  for (const s of job.stages) {
    for (const w of s.planWorkers) {
      const row =
        labourRows.get(w.employeeId) ??
        ({ id: w.employeeId, name: w.employee.name, skill: w.employee.skill, byDay: new Map() } as LabourRow);
      for (const d of days) {
        if (inPlan(s, d)) row.byDay.set(d, { activity: s.name });
      }
      labourRows.set(w.employeeId, row);
    }
  }
  for (const a of otherAssignments) {
    const row = labourRows.get(a.employeeId);
    if (!row || !a.stage.plannedStart) continue;
    const from = istDay(a.stage.plannedStart);
    const to = istDay(a.stage.plannedEnd ?? a.stage.plannedStart);
    for (const d of days) {
      if (d < from || d > to) continue;
      const cell = row.byDay.get(d);
      if (cell) {
        cell.clash = `${jobCode(a.stage.job.jobNumber)} · ${a.stage.name}`;
      }
    }
  }
  const labour = [...labourRows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const clashCount = labour.reduce(
    (n, r) => n + [...r.byDay.values()].filter((c) => c.clash).length,
    0
  );

  // Employees available to plan onto this job's activities.
  const employees = owner
    ? await db.employee.findMany({
        where: { active: true, primaryUnitId: job.unit.id },
        select: { id: true, name: true, skill: true },
        orderBy: { name: "asc" },
      })
    : [];

  const cellW = "min-w-7 w-7";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-xl font-bold">🗺️ Manufacturing Road Map</h1>
        <div className="flex items-center gap-2">
          <Link href="/planning" className="text-sm text-blue-600 hover:underline">
            ← Planning
          </Link>
          <PrintButton />
        </div>
      </div>

      {/* Job picker */}
      <form className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-2 text-sm print:hidden">
        <div className="min-w-64 flex-1">
          <span className="block text-xs text-slate-500 mb-0.5">Job</span>
          <SearchSelect
            name="job"
            defaultValue={job.id}
            options={jobs.map((j) => ({
              value: j.id,
              label: `${j.description} — ${j.clientName} (${jobCode(j.jobNumber)} · ${j.unit.code})`,
            }))}
          />
        </div>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Show</button>
      </form>

      {/* The sheet */}
      <div className="bg-white rounded-xl shadow-sm p-3 print:shadow-none print:p-0">
        <div className="text-right text-[10px] text-slate-500">Format No.: FTE/PRD/RM</div>
        <div className="text-center">
          <p className="font-bold">FAIR TECH ENGINEERS</p>
          <p className="text-sm font-semibold">
            {job.description.toUpperCase()} — MANUFACTURING ROAD MAP
          </p>
          <p className="text-xs text-slate-500">
            {jobCode(job.jobNumber)} · {job.clientName} · {job.unit.name} · promised{" "}
            {formatDate(job.expectedCompletion)}
          </p>
        </div>

        <div className="mt-2 overflow-x-auto">
          <table className="text-[11px] border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className="border border-slate-300 px-1 py-1 sticky left-0 bg-white z-10">
                  Sr.
                </th>
                <th rowSpan={2} className="border border-slate-300 px-2 py-1 text-left min-w-52 sticky left-8 bg-white z-10">
                  ACTIVITIES
                </th>
                {weekGroups.map((w) => (
                  <th key={w.key} colSpan={w.span} className="border border-slate-300 px-1 py-0.5 font-medium">
                    {w.label}
                  </th>
                ))}
                <th rowSpan={2} className="border border-slate-300 px-2 py-1 min-w-40">
                  Team (who works on it)
                </th>
              </tr>
              <tr>
                {days.map((d) => (
                  <th
                    key={d}
                    className={`border border-slate-300 px-0.5 py-0.5 font-normal ${cellW} ${
                      isSunday(d) ? "bg-slate-300" : d === today ? "bg-orange-200" : ""
                    }`}
                    title={`${dayNum(d)} ${monthShort(d)}`}
                  >
                    {dayNum(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {job.stages.map((s, i) => {
                const actual = actualDays.get(s.id) ?? new Set<string>();
                const team = s.planWorkers.map((w) => w.employee);
                return (
                  <tr key={s.id}>
                    <td className="border border-slate-300 text-center px-1 sticky left-0 bg-white">
                      {i + 1}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 sticky left-8 bg-white">
                      <span className={s.status === "DONE" ? "line-through text-slate-400" : ""}>
                        {s.name}
                      </span>
                      {s.plannedStart && (
                        <span className="block text-[9px] text-slate-400">
                          {formatDate(s.plannedStart)} → {formatDate(s.plannedEnd ?? s.plannedStart)}
                        </span>
                      )}
                    </td>
                    {days.map((d) => {
                      const planned = inPlan(s, d);
                      const done = actual.has(d);
                      return (
                        <td
                          key={d}
                          className={`border border-slate-300 p-0 ${cellW} align-top ${
                            isSunday(d) ? "bg-slate-300" : ""
                          }`}
                          title={`${s.name} · ${dayNum(d)} ${monthShort(d)}${
                            planned ? " · planned" : ""
                          }${done ? " · worked" : ""}`}
                        >
                          {/* top half = plan (yellow), bottom half = actual (green) */}
                          <div className={`h-2.5 ${planned ? "bg-yellow-300" : ""}`} />
                          <div className={`h-2.5 ${done ? "bg-green-600" : ""}`} />
                        </td>
                      );
                    })}
                    <td className="border border-slate-300 px-2 py-1 align-top">
                      {s.roadmapNote && (
                        <span className="mr-1 rounded bg-slate-100 px-1 text-[10px]">{s.roadmapNote}</span>
                      )}
                      {team.length === 0 ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {team.map((e) => (
                            <span key={e.id} className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 text-[10px]">
                              {e.name}
                              {owner && (
                                <form action={removeStageWorker} className="print:hidden inline">
                                  <input type="hidden" name="stageId" value={s.id} />
                                  <input type="hidden" name="employeeId" value={e.id} />
                                  <button className="text-slate-400 hover:text-red-600" title="Remove">
                                    ✕
                                  </button>
                                </form>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend, exactly like the sheet */}
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-6 bg-slate-300 border border-slate-400" /> Weekly OFF
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-6 bg-white border border-slate-400" /> Working Day
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-6 bg-yellow-300 border border-slate-400" /> Plan
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-6 bg-green-600 border border-slate-400" /> Actual
          </span>
        </div>
        <div className="mt-3 flex justify-between text-[10px] text-slate-500">
          <span>Prepared By — {user.name}</span>
          <span>Verified By — Mr. Atmaram Mahajan</span>
        </div>
      </div>

      {/* Labour plan: who is on what, day by day */}
      <div className="bg-white rounded-xl shadow-sm p-3 print:shadow-none">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">👷 Labour plan — who works on what</h2>
          {clashCount > 0 && (
            <span className="text-xs text-red-700 font-medium">
              ⚠️ {clashCount} day(s) double-booked on another job
            </span>
          )}
        </div>
        {labour.length === 0 ? (
          <p className="text-sm text-slate-400 mt-2">
            Nobody planned yet. {owner ? "Add workers to the activities below." : ""}
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="border border-slate-300 px-2 py-1 text-left min-w-40 sticky left-0 bg-white z-10">
                    Worker
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      className={`border border-slate-300 px-0.5 py-0.5 font-normal ${cellW} ${
                        isSunday(d) ? "bg-slate-300" : d === today ? "bg-orange-200" : ""
                      }`}
                    >
                      {dayNum(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labour.map((r) => (
                  <tr key={r.id}>
                    <td className="border border-slate-300 px-2 py-1 sticky left-0 bg-white">
                      {r.name} <span className="text-slate-400">({r.skill})</span>
                    </td>
                    {days.map((d) => {
                      const cell = r.byDay.get(d);
                      return (
                        <td
                          key={d}
                          className={`border border-slate-300 p-0 h-5 ${cellW} ${
                            cell?.clash
                              ? "bg-red-500"
                              : cell
                              ? "bg-yellow-300"
                              : isSunday(d)
                              ? "bg-slate-300"
                              : ""
                          }`}
                          title={
                            cell
                              ? `${r.name}: ${cell.activity}${
                                  cell.clash ? ` — also planned on ${cell.clash}` : ""
                                }`
                              : ""
                          }
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500 mt-1">
              Yellow = planned on this job that day. Red = the same worker is also planned on
              another job that day — hover or tap a red cell to see which.
            </p>
          </div>
        )}
      </div>

      {/* Owner's plan editor */}
      {owner && (
        <div className="bg-white rounded-xl shadow-sm p-3 print:hidden">
          <h2 className="font-semibold mb-2">✏️ Set the plan</h2>
          <div className="space-y-2">
            {job.stages.map((s, i) => (
              <div key={s.id} className="rounded-lg border border-slate-200 p-2">
                <p className="text-sm font-medium">
                  {i + 1}. {s.name}
                </p>
                <div className="mt-1 flex flex-wrap items-end gap-2">
                  <form action={setStagePlan} className="flex flex-wrap items-end gap-1.5 text-xs">
                    <input type="hidden" name="stageId" value={s.id} />
                    <label>
                      <span className="block text-slate-500">Plan from</span>
                      <input
                        type="date"
                        name="plannedStart"
                        defaultValue={s.plannedStart ? istDay(s.plannedStart) : ""}
                        className="rounded border border-slate-300 px-1.5 py-1"
                        style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                      />
                    </label>
                    <label>
                      <span className="block text-slate-500">to</span>
                      <input
                        type="date"
                        name="plannedEnd"
                        defaultValue={s.plannedEnd ? istDay(s.plannedEnd) : ""}
                        className="rounded border border-slate-300 px-1.5 py-1"
                        style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                      />
                    </label>
                    <label>
                      <span className="block text-slate-500">Note</span>
                      <input
                        name="roadmapNote"
                        defaultValue={s.roadmapNote ?? ""}
                        placeholder="e.g. NA"
                        className="w-20 rounded border border-slate-300 px-1.5 py-1"
                      />
                    </label>
                    <button className="rounded bg-slate-900 text-white px-2.5 py-1">Save</button>
                  </form>
                  <form action={addStageWorker} className="flex items-end gap-1.5 text-xs">
                    <input type="hidden" name="stageId" value={s.id} />
                    <div className="min-w-48">
                      <span className="block text-slate-500">Add worker</span>
                      <SearchSelect
                        name="employeeId"
                        small
                        options={employees.map((e) => ({
                          value: e.id,
                          label: `${e.name} (${e.skill})`,
                        }))}
                      />
                    </div>
                    <button className="rounded bg-blue-600 text-white px-2.5 py-1">+ Add</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
