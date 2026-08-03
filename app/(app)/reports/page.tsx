import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { formatDate, formatMoney, jobCode } from "@/lib/format";
import { workedByStage, fmtWorked, unionMinutes } from "@/lib/idle";
import { overheadByJob } from "@/lib/overheads";
import { PrintButton } from "@/components/print-button";
import { otOverlapMinutes } from "@/lib/ot";
import { getConsumableCosts } from "@/lib/consumables";

export const dynamic = "force-dynamic";

// Owner-only Reports. Five views over the same live data:
//   daily      — daily labour report (one date)
//   production — output, dispatches with margins, WIP (date range)
//   planning   — plans vs execution, late reasons (recent plans)
//   stages     — stage-wise averages and bottlenecks (date range)
//   kpi        — business KPIs an MNC would track (date range)

const DAY = 86400000;
const IST_MS = 5.5 * 3600e3;

function istDayStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
// Instant when an IST calendar date (YYYY-MM-DD) begins.
function dayStart(s: string): Date {
  return new Date(new Date(s).getTime() - IST_MS);
}
function overlapMinutes(
  start: Date,
  end: Date | null,
  winStart: Date,
  winEnd: Date,
  now: Date
): number {
  const s = Math.max(start.getTime(), winStart.getTime());
  const e = Math.min((end ?? now).getTime(), winEnd.getTime());
  return Math.max(0, (e - s) / 60000);
}

const REPORTS = [
  ["daily", "📅 Daily Labour"],
  ["production", "🏭 Production"],
  ["planning", "🗓️ Planning vs Execution"],
  ["stages", "🧩 Stage-wise"],
  ["kpi", "📈 Business KPIs"],
] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; d?: string; from?: string; to?: string }>;
}) {
  await requireRole("SUPERADMIN");
  const sp = await searchParams;
  const r = sp.r ?? "daily";
  const today = istDayStr(new Date());
  const d = sp.d ?? today;
  const from = sp.from ?? istDayStr(new Date(Date.now() - 6 * DAY));
  const to = sp.to ?? today;
  const now = new Date();
  const winStart = dayStart(from);
  const winEnd = new Date(dayStart(to).getTime() + DAY);

  const units = await db.unit.findMany({ orderBy: { name: "asc" } });
  const unitName = new Map(units.map((u) => [u.id, u.name]));

  const qs = (over: Record<string, string>) =>
    "?" + new URLSearchParams({ r, d, from, to, ...over }).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">📊 Reports</h1>
        <PrintButton />
      </div>

      {/* Report picker */}
      <div className="flex flex-wrap gap-1.5 print:hidden">
        {REPORTS.map(([key, label]) => (
          <Link
            key={key}
            href={qs({ r: key })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              r === key ? "bg-slate-900 text-white" : "bg-white shadow-sm hover:bg-slate-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Date controls */}
      <form className="flex flex-wrap items-end gap-2 bg-white rounded-xl shadow-sm p-3 text-sm print:hidden">
        <input type="hidden" name="r" value={r} />
        {r === "daily" ? (
          <label>
            <span className="block text-xs text-slate-500 mb-0.5">Date</span>
            <input type="date" name="d" defaultValue={d} className="rounded-lg border border-slate-300 px-2 py-1.5" />
          </label>
        ) : (
          <>
            <label>
              <span className="block text-xs text-slate-500 mb-0.5">From</span>
              <input type="date" name="from" defaultValue={from} className="rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
            <label>
              <span className="block text-xs text-slate-500 mb-0.5">To</span>
              <input type="date" name="to" defaultValue={to} className="rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
          </>
        )}
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Go</button>
      </form>

      {r === "daily" && <DailyLabour d={d} unitName={unitName} now={now} />}
      {r === "production" && (
        <Production winStart={winStart} winEnd={winEnd} from={from} to={to} unitName={unitName} now={now} />
      )}
      {r === "planning" && <PlanningReport unitName={unitName} now={now} />}
      {r === "stages" && <StagesReport winStart={winStart} winEnd={winEnd} from={from} to={to} />}
      {r === "kpi" && <KpiReport winStart={winStart} winEnd={winEnd} from={from} to={to} now={now} />}
    </div>
  );
}

// ---------------------------------------------------------------- daily ----
async function DailyLabour({
  d,
  unitName,
  now,
}: {
  d: string;
  unitName: Map<string, string>;
  now: Date;
}) {
  const s = dayStart(d);
  const e = new Date(s.getTime() + DAY);
  const [logs, employees, leaves, disciplines] = await Promise.all([
    db.timeLog.findMany({
      where: { startedAt: { lt: e }, OR: [{ endedAt: null }, { endedAt: { gt: s } }] },
      include: {
        employee: { select: { id: true, name: true, hourlyWage: true, primaryUnitId: true } },
        job: { select: { jobNumber: true, description: true } },
      },
    }),
    db.employee.findMany({ where: { active: true }, select: { id: true, primaryUnitId: true } }),
    db.leaveDay.findMany({ where: { date: new Date(d) }, include: { employee: { select: { name: true, primaryUnitId: true } } } }),
    db.discipline.findMany({
      where: { createdAt: { gte: s, lt: e } },
      include: { employee: { select: { name: true } } },
    }),
  ]);

  type Row = {
    name: string;
    unitId: string;
    jobMin: number;
    dutyMin: number;
    otMin: number;
    wage: number | null;
    jobs: Set<string>;
  };
  const rows = new Map<string, Row>();
  for (const l of logs) {
    const m = overlapMinutes(l.startedAt, l.endedAt, s, e, now);
    if (m <= 0) continue;
    const row =
      rows.get(l.employee.id) ??
      ({ name: l.employee.name, unitId: l.employee.primaryUnitId, jobMin: 0, dutyMin: 0, otMin: 0, wage: l.employee.hourlyWage, jobs: new Set() } as Row);
    if (l.activity === "STAGE" || l.jobId) row.jobMin += m;
    else row.dutyMin += m;
    // OT = worked time after 10 PM of this day (till 6 AM next morning)
    row.otMin += otOverlapMinutes(
      l.startedAt,
      l.endedAt ?? now,
      new Date(s.getTime() + 22 * 3600e3),
      new Date(s.getTime() + 32 * 3600e3)
    );
    if (l.job) row.jobs.add(`${l.job.description}`);
    rows.set(l.employee.id, row);
  }
  const byUnit = new Map<string, Row[]>();
  for (const row of rows.values()) {
    byUnit.set(row.unitId, [...(byUnit.get(row.unitId) ?? []), row]);
  }
  const rosterByUnit = new Map<string, number>();
  for (const emp of employees) {
    rosterByUnit.set(emp.primaryUnitId, (rosterByUnit.get(emp.primaryUnitId) ?? 0) + 1);
  }
  const totalCost = [...rows.values()].reduce(
    (sum, row) => sum + (row.wage ?? 0) * ((row.jobMin + row.dutyMin) / 60),
    0
  );
  const totalMin = [...rows.values()].reduce((sum, row) => sum + row.jobMin + row.dutyMin, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">Daily Labour Report — <b>{formatDate(new Date(d))}</b></span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{rows.size}</b> worked</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{(totalMin / 60).toFixed(1)}</b> man-hours</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">labour cost <b>{formatMoney(totalCost)}</b></span>
      </div>
      {[...byUnit.entries()].map(([unitId, list]) => (
        <section key={unitId} className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-2">
            {unitName.get(unitId) ?? "—"}{" "}
            <span className="text-sm text-slate-500 font-normal">
              {list.length} worked / {rosterByUnit.get(unitId) ?? 0} on roster
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="px-2 py-2">Worker</th>
                  <th className="px-2 py-2">Job hours</th>
                  <th className="px-2 py-2">Duty hours</th>
                  <th className="px-2 py-2">OT</th>
                  <th className="px-2 py-2">Cost</th>
                  <th className="px-2 py-2">Jobs touched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list
                  .sort((a, b) => b.jobMin + b.dutyMin - a.jobMin - a.dutyMin)
                  .map((row) => (
                    <tr key={row.name}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{row.name}</td>
                      <td className="px-2 py-1.5">{(row.jobMin / 60).toFixed(1)}</td>
                      <td className="px-2 py-1.5">{(row.dutyMin / 60).toFixed(1)}</td>
                      <td className="px-2 py-1.5">{row.otMin > 0 ? `${(row.otMin / 60).toFixed(1)}h` : "—"}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {row.wage !== null
                          ? formatMoney(row.wage * ((row.jobMin + row.dutyMin) / 60))
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">{[...row.jobs].join(", ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {(leaves.length > 0 || disciplines.length > 0) && (
        <section className="bg-white rounded-xl shadow-sm p-4 text-sm space-y-1">
          {leaves.length > 0 && (
            <p>
              🏖 <b>On leave:</b>{" "}
              {leaves.map((l) => `${l.employee.name} (${unitName.get(l.employee.primaryUnitId) ?? ""})`).join(", ")}
            </p>
          )}
          {disciplines.length > 0 && (
            <p>
              ⚠️ <b>Discipline:</b>{" "}
              {disciplines.map((x) => `${x.employee.name} — ${x.reason}, ${x.hoursCut}h cut`).join("; ")}
            </p>
          )}
        </section>
      )}
      {rows.size === 0 && (
        <p className="text-center text-slate-400 py-8">No work logged on this date.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------- production ----
async function Production({
  winStart,
  winEnd,
  from,
  to,
  unitName,
  now,
}: {
  winStart: Date;
  winEnd: Date;
  from: string;
  to: string;
  unitName: Map<string, string>;
  now: Date;
}) {
  const [stagesDone, jobsCreated, dispatched, reworks, issuesOpened, issuesResolved, rangeLogs, wip] =
    await Promise.all([
      db.stage.findMany({
        where: { completedAt: { gte: winStart, lt: winEnd } },
        include: { job: { select: { unitId: true, jobNumber: true, description: true } } },
      }),
      db.job.count({ where: { createdAt: { gte: winStart, lt: winEnd } } }),
      db.job.findMany({
        where: { status: "COMPLETED", completedAt: { gte: winStart, lt: winEnd } },
        include: {
          unit: { select: { code: true } },
          timeLogs: {
            select: {
              startedAt: true,
              endedAt: true,
              otBonusMinutes: true,
              employee: { select: { hourlyWage: true } },
            },
          },
        },
      }),
      db.stageRework.count({ where: { createdAt: { gte: winStart, lt: winEnd } } }),
      db.issue.count({ where: { createdAt: { gte: winStart, lt: winEnd } } }),
      db.issue.count({ where: { resolvedAt: { gte: winStart, lt: winEnd } } }),
      db.timeLog.findMany({
        where: { startedAt: { lt: winEnd }, OR: [{ endedAt: null }, { endedAt: { gt: winStart } }] },
        select: { startedAt: true, endedAt: true, unitId: true },
      }),
      db.job.findMany({
        where: { status: { in: ["IN_PROGRESS", "ON_HOLD", "READY_TO_DISPATCH"] } },
        include: { stages: { select: { status: true } }, unit: { select: { code: true } } },
        orderBy: { expectedCompletion: "asc" },
      }),
    ]);

  const [overheadMap, consumableMap] = await Promise.all([
    overheadByJob(dispatched.map((j) => j.id)),
    getConsumableCosts(),
  ]);
  const dispatchRows = dispatched.map((j) => {
    const labour = j.timeLogs.reduce((sum, l) => {
      if (l.employee.hourlyWage === null) return sum;
      const hours = Math.max(
        0,
        ((l.endedAt ?? j.completedAt!).getTime() - l.startedAt.getTime()) / 3600000
      );
      return sum + hours * l.employee.hourlyWage;
    }, 0);
    const consumables = consumableMap.get(j.jobNumber)?.trueCost ?? 0;
    const cost = labour + (overheadMap.get(j.id) ?? 0) + consumables;
    const margin = j.poValue !== null ? j.poValue - cost : null;
    const late = Math.round((j.completedAt!.getTime() - j.expectedCompletion.getTime()) / DAY);
    return { j, cost, consumables, margin, late };
  });
  const manMinutes = rangeLogs.reduce(
    (sum, l) => sum + overlapMinutes(l.startedAt, l.endedAt, winStart, winEnd, now),
    0
  );
  const doneByUnit = new Map<string, number>();
  for (const s of stagesDone) {
    doneByUnit.set(s.job.unitId, (doneByUnit.get(s.job.unitId) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
          Production Report — <b>{formatDate(new Date(from))} – {formatDate(new Date(to))}</b>
        </span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{stagesDone.length}</b> stages completed</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{jobsCreated}</b> jobs created</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{dispatched.length}</b> dispatched</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{(manMinutes / 60).toFixed(0)}</b> man-hours</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm"><b>{reworks}</b> reworks</span>
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">issues <b>{issuesOpened}</b> raised / <b>{issuesResolved}</b> resolved</span>
      </div>

      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-2">Stages completed per unit</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          {[...unitName.entries()].map(([id, name]) => (
            <span key={id} className="bg-slate-50 rounded-lg px-3 py-1.5">
              {name}: <b>{doneByUnit.get(id) ?? 0}</b>
            </span>
          ))}
        </div>
      </section>

      {dispatchRows.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm p-4 overflow-x-auto">
          <h2 className="font-semibold mb-2">Dispatched in this period</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-2 py-2">Job</th>
                <th className="px-2 py-2">Unit</th>
                <th className="px-2 py-2">Dispatched</th>
                <th className="px-2 py-2">Vs promise</th>
                <th className="px-2 py-2">PO value</th>
                <th className="px-2 py-2">Consumables</th>
                <th className="px-2 py-2">Cost (all-in)</th>
                <th className="px-2 py-2">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dispatchRows.map(({ j, cost, consumables, margin, late }) => (
                <tr key={j.id}>
                  <td className="px-2 py-1.5">
                    <Link href={`/jobs/${j.id}`} className="text-blue-700 hover:underline">
                      {j.description} <span className="text-slate-400 text-xs">{jobCode(j.jobNumber)}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{j.unit.code}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(j.completedAt!)}</td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${late > 0 ? "text-red-700 font-medium" : "text-green-700"}`}>
                    {late > 0 ? `${late}d late` : late < 0 ? `${-late}d early` : "on time"}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{j.poValue !== null ? formatMoney(j.poValue) : "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{consumables > 0 ? formatMoney(consumables) : "—"}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatMoney(cost)}</td>
                  <td className={`px-2 py-1.5 whitespace-nowrap font-medium ${margin !== null && margin < 0 ? "text-red-700" : "text-green-700"}`}>
                    {margin !== null
                      ? `${formatMoney(margin)}${j.poValue ? ` (${((margin / j.poValue) * 100).toFixed(0)}%)` : ""}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-2">Work in progress right now</h2>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {wip.map((j) => {
            const done = j.stages.filter((s) => s.status === "DONE").length;
            return (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm hover:bg-slate-100"
              >
                <span className="truncate">
                  {j.description} <span className="text-slate-400 text-xs">{jobCode(j.jobNumber)} · {j.unit.code}</span>
                </span>
                <span className="whitespace-nowrap text-xs font-medium">
                  {done}/{j.stages.length} · due {formatDate(j.expectedCompletion)}
                </span>
              </Link>
            );
          })}
          {wip.length === 0 && <p className="text-slate-400 text-sm">Nothing in progress.</p>}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------- planning ----
async function PlanningReport({
  unitName,
  now,
}: {
  unitName: Map<string, string>;
  now: Date;
}) {
  const plans = await db.plan.findMany({
    include: {
      unit: { select: { name: true } },
      items: { include: { stage: { select: { status: true, completedAt: true } }, job: { select: { status: true, completedAt: true } } } },
    },
    orderBy: { startDate: "desc" },
    take: 8,
  });
  void unitName;

  const rows = plans.map((p) => {
    let onTime = 0,
      late = 0,
      lateDaysSum = 0,
      pendingOverdue = 0,
      pending = 0;
    const reasons: string[] = [];
    for (const i of p.items) {
      const done =
        i.done || i.stage?.status === "DONE" || (i.isDispatch && i.job?.status === "COMPLETED");
      const actual = i.stage?.completedAt ?? (i.isDispatch ? i.job?.completedAt ?? null : null) ?? i.doneAt;
      if (done && actual) {
        const diff = Math.round((actual.getTime() - i.targetDate.getTime()) / DAY);
        if (diff > 0) {
          late++;
          lateDaysSum += diff;
        } else onTime++;
      } else if (i.targetDate.getTime() + DAY < now.getTime()) pendingOverdue++;
      else pending++;
      if (i.lateReason) reasons.push(`${i.description}: ${i.lateReason} (${i.lateReasonBy})`);
    }
    return { p, onTime, late, lateDaysSum, pendingOverdue, pending, reasons };
  });

  return (
    <div className="space-y-4">
      {rows.map(({ p, onTime, late, lateDaysSum, pendingOverdue, pending, reasons }) => {
        const total = p.items.length;
        const score = total > 0 ? Math.round((onTime / total) * 100) : null;
        return (
          <section key={p.id} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {p.name} <span className="text-sm font-normal text-slate-500">{p.unit?.name ?? "All units"} · {formatDate(p.startDate)} – {formatDate(p.endDate)}</span>
              </h2>
              {score !== null && (
                <span className={`rounded-lg px-3 py-1 text-sm font-bold ${score >= 80 ? "bg-green-100 text-green-800" : score >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                  {score}% on time
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="bg-green-50 rounded px-2 py-1">✅ on time: <b>{onTime}</b></span>
              <span className="bg-red-50 rounded px-2 py-1">🔴 done late: <b>{late}</b>{late > 0 && ` (avg ${(lateDaysSum / late).toFixed(1)}d)`}</span>
              <span className="bg-red-100 rounded px-2 py-1">⏰ overdue now: <b>{pendingOverdue}</b></span>
              <span className="bg-slate-50 rounded px-2 py-1">⬜ upcoming: <b>{pending}</b></span>
            </div>
            {reasons.length > 0 && (
              <div className="text-xs text-slate-600 space-y-0.5">
                <p className="font-semibold">Late reasons given:</p>
                {reasons.map((t, i) => (
                  <p key={i}>📝 {t}</p>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {rows.length === 0 && <p className="text-center text-slate-400 py-8">No plans yet.</p>}
    </div>
  );
}

// --------------------------------------------------------------- stages ----
async function StagesReport({
  winStart,
  winEnd,
  from,
  to,
}: {
  winStart: Date;
  winEnd: Date;
  from: string;
  to: string;
}) {
  const done = await db.stage.findMany({
    where: { completedAt: { gte: winStart, lt: winEnd }, startedAt: { not: null } },
    include: {
      job: { select: { jobNumber: true, description: true } },
      reworks: { select: { id: true } },
    },
  });
  const logs = await db.timeLog.findMany({
    where: { stageId: { in: done.map((s) => s.id) } },
    select: { stageId: true, startedAt: true, endedAt: true },
  });
  const worked = workedByStage(logs);
  const manByStage = new Map<string, number>();
  for (const l of logs) {
    if (!l.endedAt) continue;
    manByStage.set(
      l.stageId!,
      (manByStage.get(l.stageId!) ?? 0) + (l.endedAt.getTime() - l.startedAt.getTime()) / 60000
    );
  }

  type Agg = { count: number; workedMin: number; manMin: number; spanMin: number; reworks: number };
  const byName = new Map<string, Agg>();
  for (const s of done) {
    const a = byName.get(s.name) ?? { count: 0, workedMin: 0, manMin: 0, spanMin: 0, reworks: 0 };
    a.count++;
    a.workedMin += worked.get(s.id) ?? 0;
    a.manMin += manByStage.get(s.id) ?? 0;
    a.spanMin += (s.completedAt!.getTime() - s.startedAt!.getTime()) / 60000;
    a.reworks += s.reworks.length;
    byName.set(s.name, a);
  }
  const rows = [...byName.entries()].sort((a, b) => b[1].workedMin / b[1].count - a[1].workedMin / a[1].count);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
          Stage-wise Report — <b>{formatDate(new Date(from))} – {formatDate(new Date(to))}</b> (stages completed in period)
        </span>
      </div>
      <section className="bg-white rounded-xl shadow-sm p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-2 py-2">Stage</th>
              <th className="px-2 py-2">Done</th>
              <th className="px-2 py-2">Avg worked (excl. idle)</th>
              <th className="px-2 py-2">Avg man-hours</th>
              <th className="px-2 py-2">Avg calendar span</th>
              <th className="px-2 py-2">Reworks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([name, a]) => (
              <tr key={name} className={a.reworks > 0 ? "bg-purple-50/50" : ""}>
                <td className="px-2 py-1.5 font-medium">{name}</td>
                <td className="px-2 py-1.5">{a.count}</td>
                <td className="px-2 py-1.5">{fmtWorked(a.workedMin / a.count)}</td>
                <td className="px-2 py-1.5">{(a.manMin / a.count / 60).toFixed(1)} h</td>
                <td className="px-2 py-1.5">{fmtWorked(a.spanMin / a.count)}</td>
                <td className="px-2 py-1.5">{a.reworks > 0 ? `🟣 ${a.reworks}` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-8 text-center text-slate-400">
                  No stages completed in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          Sorted slowest first — the top rows are your bottleneck stages. Purple rows had reworks.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ kpi ----
async function KpiReport({
  winStart,
  winEnd,
  from,
  to,
  now,
}: {
  winStart: Date;
  winEnd: Date;
  from: string;
  to: string;
  now: Date;
}) {
  const days = Math.max(1, Math.round((winEnd.getTime() - winStart.getTime()) / DAY));
  const [dispatched, logs, reworks, stagesDone, roster, wip, leaves, consumableMap] = await Promise.all([
    db.job.findMany({
      where: { status: "COMPLETED", completedAt: { gte: winStart, lt: winEnd } },
      include: {
        timeLogs: {
          select: { startedAt: true, endedAt: true, otBonusMinutes: true, employee: { select: { hourlyWage: true } } },
        },
      },
    }),
    db.timeLog.findMany({
      where: { startedAt: { lt: winEnd }, OR: [{ endedAt: null }, { endedAt: { gt: winStart } }] },
      select: { startedAt: true, endedAt: true, employeeId: true, employee: { select: { hourlyWage: true } } },
    }),
    db.stageRework.count({ where: { createdAt: { gte: winStart, lt: winEnd } } }),
    db.stage.count({ where: { completedAt: { gte: winStart, lt: winEnd } } }),
    db.employee.count({ where: { active: true } }),
    db.job.findMany({
      where: { status: { in: ["IN_PROGRESS", "ON_HOLD", "READY_TO_DISPATCH"] } },
      select: { expectedCompletion: true },
    }),
    db.leaveDay.count({ where: { date: { gte: new Date(from), lte: new Date(to) } } }),
    getConsumableCosts(),
  ]);

  // Delivery
  const onTime = dispatched.filter((j) => j.completedAt!.getTime() <= j.expectedCompletion.getTime() + DAY).length;
  const otif = dispatched.length > 0 ? Math.round((onTime / dispatched.length) * 100) : null;
  // Revenue & margin
  const overheadMap = await overheadByJob(dispatched.map((j) => j.id));
  let revenue = 0,
    totalCost = 0,
    consumablesCost = 0,
    cycleDaysSum = 0,
    lateDaysSum = 0,
    lateCount = 0;
  for (const j of dispatched) {
    revenue += j.poValue ?? 0;
    const labour = j.timeLogs.reduce((sum, l) => {
      if (l.employee.hourlyWage === null) return sum;
      return (
        sum +
        Math.max(0, ((l.endedAt ?? j.completedAt!).getTime() - l.startedAt.getTime()) / 3600000) *
          l.employee.hourlyWage
      );
    }, 0);
    const cons = consumableMap.get(j.jobNumber)?.trueCost ?? 0;
    consumablesCost += cons;
    totalCost += labour + (overheadMap.get(j.id) ?? 0) + cons;
    cycleDaysSum += Math.max(0, (j.completedAt!.getTime() - j.createdAt.getTime()) / DAY);
    const lateBy = (j.completedAt!.getTime() - j.expectedCompletion.getTime()) / DAY;
    if (lateBy > 1) {
      lateCount++;
      lateDaysSum += lateBy;
    }
  }
  const margin = revenue - totalCost;
  const avgCycleDays = dispatched.length > 0 ? cycleDaysSum / dispatched.length : null;
  const avgLateDays = lateCount > 0 ? lateDaysSum / lateCount : null;
  const wipOverdue = wip.filter((j) => j.expectedCompletion.getTime() < now.getTime()).length;
  const consumableShare = totalCost > 0 ? Math.round((consumablesCost / totalCost) * 100) : null;
  // Hours & utilisation
  const manMinutes = logs.reduce((sum, l) => sum + overlapMinutes(l.startedAt, l.endedAt, winStart, winEnd, now), 0);
  // Worker-days: a shift crossing midnight counts on both days it touches.
  const presentDays = new Set(
    logs.flatMap((l) => {
      const keys: string[] = [];
      const end = l.endedAt ?? now;
      for (
        let t = Math.max(l.startedAt.getTime(), winStart.getTime());
        t < Math.min(end.getTime(), winEnd.getTime());
        t = dayStart(istDayStr(new Date(t))).getTime() + DAY
      ) {
        keys.push(`${l.employeeId}|${istDayStr(new Date(t))}`);
      }
      return keys;
    })
  ).size;
  const utilisation = presentDays > 0 ? Math.round((manMinutes / 60 / (presentDays * 8)) * 100) : null;
  const absenteeism = roster > 0 ? Math.round((1 - presentDays / (roster * days)) * 100) : null;
  const otHours =
    logs.reduce(
      (sum, l) => sum + otOverlapMinutes(l.startedAt, l.endedAt ?? now, winStart, winEnd),
      0
    ) / 60;
  const otShare = manMinutes > 0 ? Math.round(((otHours * 60) / manMinutes) * 100) : null;
  // Blended labour rate: what an average clocked hour costs in wages.
  const periodLabourCost = logs.reduce(
    (sum, l) =>
      sum +
      (l.employee.hourlyWage ?? 0) *
        (overlapMinutes(l.startedAt, l.endedAt, winStart, winEnd, now) / 60),
    0
  );
  const blendedRate = manMinutes > 0 ? periodLabourCost / (manMinutes / 60) : null;
  const revenuePerHour = manMinutes > 0 && revenue > 0 ? revenue / (manMinutes / 60) : null;
  const reworkRate = stagesDone > 0 ? Math.round((reworks / stagesDone) * 100) : null;

  const Kpi = ({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "good" | "bad" | "" }) => (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-700" : ""}`}>{value}</p>
      <p className="text-[11px] text-slate-400 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
          Business KPIs — <b>{formatDate(new Date(from))} – {formatDate(new Date(to))}</b>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label="On-time delivery (OTIF)"
          value={otif !== null ? `${otif}%` : "—"}
          hint={`${onTime}/${dispatched.length} jobs dispatched by the promised date. MNC target: 95%+.`}
          tone={otif !== null ? (otif >= 80 ? "good" : "bad") : ""}
        />
        <Kpi
          label="Revenue dispatched"
          value={formatMoney(revenue)}
          hint="Sum of PO values (without GST) of jobs dispatched in the period."
        />
        <Kpi
          label="Margin"
          value={`${formatMoney(margin)}${revenue > 0 ? ` (${((margin / revenue) * 100).toFixed(0)}%)` : ""}`}
          hint="PO value minus labour + overheads + consumables of the dispatched jobs."
          tone={margin >= 0 ? "good" : "bad"}
        />
        <Kpi
          label="Consumables cost"
          value={formatMoney(consumablesCost)}
          hint={`Store-app consumables in the dispatched jobs${consumableShare !== null ? ` — ${consumableShare}% of total cost` : ""}. MNCs watch this creeping past 8–10%.`}
        />
        <Kpi
          label="Revenue per man-hour"
          value={revenuePerHour !== null ? formatMoney(revenuePerHour) : "—"}
          hint="PO value dispatched ÷ hours clocked in the period. Your headline productivity number."
        />
        <Kpi
          label="Blended labour rate"
          value={blendedRate !== null ? `${formatMoney(blendedRate)}/hr` : "—"}
          hint="Average wage cost of one clocked hour. Rising rate with flat output = costlier mix of workers."
        />
        <Kpi
          label="Avg cycle time"
          value={avgCycleDays !== null ? `${avgCycleDays.toFixed(1)} d` : "—"}
          hint="Job created → dispatched, averaged over the period's dispatches. Shorter = faster cash."
        />
        <Kpi
          label="Avg delay when late"
          value={avgLateDays !== null ? `${avgLateDays.toFixed(1)} d` : lateCount === 0 && dispatched.length > 0 ? "none late" : "—"}
          hint={`${lateCount} of ${dispatched.length} dispatches were late. How badly promises slip when they slip.`}
          tone={lateCount === 0 && dispatched.length > 0 ? "good" : avgLateDays !== null ? "bad" : ""}
        />
        <Kpi
          label="WIP on the floor"
          value={`${wip.length} job${wip.length === 1 ? "" : "s"}`}
          hint={`${wipOverdue} already past their promised date. High WIP with low dispatches = money stuck on the floor.`}
          tone={wipOverdue > 0 ? "bad" : wip.length > 0 ? "" : "good"}
        />
        <Kpi
          label="Labour utilisation"
          value={utilisation !== null ? `${utilisation}%` : "—"}
          hint="Clocked hours vs 8h per present worker-day. Low = idle hands; watch shifting discipline."
          tone={utilisation !== null ? (utilisation >= 65 ? "good" : "bad") : ""}
        />
        <Kpi
          label="Rework rate"
          value={reworkRate !== null ? `${reworkRate}%` : "—"}
          hint={`${reworks} reworks vs ${stagesDone} stages completed. MNCs treat >5% as a quality alarm.`}
          tone={reworkRate !== null ? (reworkRate <= 5 ? "good" : "bad") : ""}
        />
        <Kpi
          label="Overtime (after 10 PM)"
          value={`${otHours.toFixed(1)} h${otShare !== null ? ` (${otShare}%)` : ""}`}
          hint="Hours clocked between 10 PM and 6 AM. High OT with low utilisation = planning problem, not capacity."
        />
        <Kpi
          label="Man-hours worked"
          value={`${(manMinutes / 60).toFixed(0)} h`}
          hint={`Across ${presentDays} worker-days in ${days} day(s).`}
        />
        <Kpi
          label="Absenteeism (approx)"
          value={absenteeism !== null ? `${absenteeism}%` : "—"}
          hint={`Worker-days without any clocked work vs roster of ${roster}. ${leaves} leave day(s) marked.`}
        />
      </div>
      <p className="text-xs text-slate-500">
        How to read this like an MNC: OTIF, cycle time and margin tell you if promises and pricing
        are right; utilisation, WIP and OT tell you if the shop floor is planned well; rework rate
        and consumables share are your quality and material cost. Chase the worst number first —
        one point of rework or idle time usually pays for itself faster than more overtime.
        Consumable figures come from the Store app and cover each job&apos;s lifetime.
      </p>
    </div>
  );
}
