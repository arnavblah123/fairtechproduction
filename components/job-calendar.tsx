import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { otOverlapMinutes } from "@/lib/ot";
import { unionMinutes } from "@/lib/idle";

// Job timesheet calendar. Every day cell is filled with the stages that were
// worked that day, each stage in its own colour and carrying its hours — so
// "welding ran 8 hours one day and 2 the next" reads straight off the
// calendar. Tap a stage to see who was on it and for how long. The plan's
// target dates sit on the same calendar, so plan and reality overlap in one
// picture.

const DAY = 86400000;
const IST_MS = 5.5 * 3600e3;

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayStartInstant = (day: string) => new Date(new Date(day).getTime() - IST_MS);
const isSunday = (day: string) => new Date(day).getUTCDay() === 0;
const dayNum = (day: string) => Number(day.slice(8, 10));

export function fmtHours(minutes: number): string {
  const h = minutes / 60;
  if (h >= 10) return `${Math.round(h)}h`;
  if (h < 1) return `${Math.round(minutes)}m`;
  return `${h.toFixed(1)}h`;
}

// One fixed colour per stage, by its position in the job's process.
const STAGE_COLORS = [
  { bar: "bg-blue-500", soft: "bg-blue-100 text-blue-900", ring: "ring-blue-500" },
  { bar: "bg-emerald-500", soft: "bg-emerald-100 text-emerald-900", ring: "ring-emerald-500" },
  { bar: "bg-amber-500", soft: "bg-amber-100 text-amber-900", ring: "ring-amber-500" },
  { bar: "bg-violet-500", soft: "bg-violet-100 text-violet-900", ring: "ring-violet-500" },
  { bar: "bg-rose-500", soft: "bg-rose-100 text-rose-900", ring: "ring-rose-500" },
  { bar: "bg-cyan-500", soft: "bg-cyan-100 text-cyan-900", ring: "ring-cyan-500" },
  { bar: "bg-orange-500", soft: "bg-orange-100 text-orange-900", ring: "ring-orange-500" },
  { bar: "bg-lime-600", soft: "bg-lime-100 text-lime-900", ring: "ring-lime-600" },
  { bar: "bg-fuchsia-500", soft: "bg-fuchsia-100 text-fuchsia-900", ring: "ring-fuchsia-500" },
  { bar: "bg-teal-500", soft: "bg-teal-100 text-teal-900", ring: "ring-teal-500" },
  { bar: "bg-indigo-500", soft: "bg-indigo-100 text-indigo-900", ring: "ring-indigo-500" },
  { bar: "bg-red-500", soft: "bg-red-100 text-red-900", ring: "ring-red-500" },
];
const DUTY_COLOR = { bar: "bg-slate-400", soft: "bg-slate-100 text-slate-700", ring: "ring-slate-400" };

// Split a session across the IST days it spans (a night shift covers two).
function splitByDay(start: Date, end: Date): { day: string; minutes: number }[] {
  const out: { day: string; minutes: number }[] = [];
  let t = start.getTime();
  const stop = end.getTime();
  let guard = 0;
  while (t < stop && guard++ < 60) {
    const day = istDay(new Date(t));
    const chunkEnd = Math.min(stop, dayStartInstant(day).getTime() + DAY);
    out.push({ day, minutes: (chunkEnd - t) / 60000 });
    t = chunkEnd;
  }
  return out;
}

export async function JobCalendar({
  jobId,
  month: monthParam,
  stageId: openStageId,
  basePath,
  extraParams = {},
}: {
  jobId: string;
  month?: string;
  stageId?: string;
  /** Where the calendar's own links point, e.g. "/jobs/abc" or "/calendar" */
  basePath: string;
  /** Query params to keep on every link (e.g. { job: id }) */
  extraParams?: Record<string, string>;
}) {
  const [job, logs, planItems] = await Promise.all([
    db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        completedAt: true,
        expectedCompletion: true,
        stages: {
          orderBy: { sequence: "asc" },
          select: { id: true, name: true, sequence: true, status: true, completedAt: true },
        },
      },
    }),
    db.timeLog.findMany({
      where: { jobId },
      include: {
        employee: { select: { id: true, name: true, skill: true } },
        stage: { select: { id: true } },
      },
      orderBy: { startedAt: "asc" },
    }),
    db.planItem.findMany({
      where: { jobId },
      include: {
        plan: { select: { name: true } },
        stage: { select: { id: true, name: true, sequence: true, status: true, completedAt: true } },
      },
      orderBy: { targetDate: "asc" },
    }),
  ]);
  if (!job) return null;

  const colorOf = (stageId: string | null) => {
    if (!stageId) return DUTY_COLOR;
    const i = job.stages.findIndex((s) => s.id === stageId);
    return i === -1 ? DUTY_COLOR : STAGE_COLORS[i % STAGE_COLORS.length];
  };
  const stageLabel = (stageId: string | null, fallback: string) => {
    const s = job.stages.find((x) => x.id === stageId);
    return s ? `${s.sequence}. ${s.name}` : fallback;
  };

  const now = new Date();
  // key = stageId or "duty:<ACTIVITY>"
  type Key = string;
  // The calendar shows how long the activity actually RAN each day (two men
  // welding together for 8 hours is 8 hours of welding, not 16). Man-hours
  // are kept alongside for the per-worker breakdown.
  const dayIntervals = new Map<string, Map<Key, { start: Date; end: Date }[]>>();
  const perStageWorker = new Map<Key, Map<string, { name: string; skill: string; minutes: number; days: Set<string> }>>();
  const stageManMinutes = new Map<Key, number>();
  const stageOt = new Map<Key, number>();
  const keyLabel = new Map<Key, string>();
  const runningKeys = new Set<Key>();

  for (const l of logs) {
    const end = l.endedAt ?? now;
    const key: Key = l.stageId ?? `duty:${l.activity}`;
    keyLabel.set(
      key,
      l.stageId
        ? stageLabel(l.stageId, "Stage")
        : l.activity.replace(/_/g, " ").toLowerCase()
    );
    if (!l.endedAt) runningKeys.add(key);
    let cursor = l.startedAt.getTime();
    for (const part of splitByDay(l.startedAt, end)) {
      if (part.minutes <= 0) continue;
      const segStart = new Date(cursor);
      const segEnd = new Date(cursor + part.minutes * 60000);
      cursor = segEnd.getTime();

      const dayMap = dayIntervals.get(part.day) ?? new Map<Key, { start: Date; end: Date }[]>();
      dayMap.set(key, [...(dayMap.get(key) ?? []), { start: segStart, end: segEnd }]);
      dayIntervals.set(part.day, dayMap);

      const workers = perStageWorker.get(key) ?? new Map();
      const w =
        workers.get(l.employee.id) ??
        { name: l.employee.name, skill: l.employee.skill, minutes: 0, days: new Set<string>() };
      w.minutes += part.minutes;
      w.days.add(part.day);
      workers.set(l.employee.id, w);
      perStageWorker.set(key, workers);

      stageManMinutes.set(key, (stageManMinutes.get(key) ?? 0) + part.minutes);
    }
    stageOt.set(key, (stageOt.get(key) ?? 0) + otOverlapMinutes(l.startedAt, end));
  }

  // day → key → minutes the activity actually ran (overlapping men merged)
  const perDay = new Map<string, Map<Key, number>>();
  for (const [day, keys] of dayIntervals) {
    const m = new Map<Key, number>();
    for (const [key, intervals] of keys) m.set(key, unionMinutes(intervals));
    perDay.set(day, m);
  }
  // Total run-time per activity across all days.
  const stageTotals = new Map<Key, number>();
  for (const dayMap of perDay.values()) {
    for (const [key, mins] of dayMap) stageTotals.set(key, (stageTotals.get(key) ?? 0) + mins);
  }

  const workedDays = [...perDay.keys()].sort();
  const totalManMinutes = [...stageManMinutes.values()].reduce((a, b) => a + b, 0);

  // Plan targets by day, for the overlay.
  const planByDay = new Map<string, typeof planItems>();
  for (const p of planItems) {
    const d = istDay(p.revisedDate ?? p.targetDate);
    planByDay.set(d, [...(planByDay.get(d) ?? []), p]);
  }

  // Month to show: asked for, else the latest month with work, else now.
  const defaultMonth = workedDays.length
    ? workedDays[workedDays.length - 1].slice(0, 7)
    : istDay(now).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? "") ? monthParam! : defaultMonth;
  const monthStart = new Date(`${month}-01`);
  const monthLabel = monthStart.toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const shiftMonth = (n: number) =>
    new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + n, 1))
      .toISOString()
      .slice(0, 7);
  const monthsWithWork = [...new Set([...workedDays, ...planItems.map((p) => istDay(p.targetDate))])]
    .map((d) => d.slice(0, 7))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  const daysInMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const leading = (monthStart.getUTCDay() + 6) % 7; // Mon = 0
  const cells: (string | null)[] = Array(leading).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const today = istDay(now);
  const monthDays = workedDays.filter((d) => d.startsWith(month));
  const monthMinutes = monthDays.reduce(
    (s, d) => s + [...(perDay.get(d) ?? new Map()).values()].reduce((a, b) => a + b, 0),
    0
  );

  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...extraParams, m: month });
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) p.delete(k);
      else p.set(k, v);
    }
    return `${basePath}?${p.toString()}`;
  };

  // Stages that actually have work, for the legend — in process order.
  const legend = [
    ...job.stages
      .filter((s) => stageTotals.has(s.id))
      .map((s) => ({ key: s.id as Key, label: `${s.sequence}. ${s.name}`, color: colorOf(s.id) })),
    ...[...stageTotals.keys()]
      .filter((k) => k.startsWith("duty:"))
      .map((k) => ({ key: k, label: keyLabel.get(k) ?? "duty", color: DUTY_COLOR })),
  ];

  const openKey = openStageId && stageTotals.has(openStageId) ? openStageId : null;
  const openWorkers = openKey
    ? [...(perStageWorker.get(openKey) ?? new Map()).values()].sort((a, b) => b.minutes - a.minutes)
    : [];
  const openDays = openKey
    ? workedDays.filter((d) => (perDay.get(d)?.get(openKey) ?? 0) > 0)
    : [];

  return (
    <div className="space-y-3">
      {/* Totals */}
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="bg-slate-100 rounded-lg px-3 py-1.5">
          <b>{fmtHours(totalManMinutes)}</b> man-hours on this job
        </span>
        <span className="bg-slate-100 rounded-lg px-3 py-1.5">
          <b>{workedDays.length}</b> working day{workedDays.length === 1 ? "" : "s"}
        </span>
        {workedDays.length > 0 && (
          <span className="bg-slate-100 rounded-lg px-3 py-1.5">
            {formatDate(new Date(workedDays[0]))} → {formatDate(new Date(workedDays[workedDays.length - 1]))}
          </span>
        )}
      </div>

      {workedDays.length === 0 && planItems.length === 0 ? (
        <p className="text-sm text-slate-400 py-4">
          No work clocked on this job yet — the calendar fills itself as the shop floor logs time.
        </p>
      ) : (
        <>
          {/* Month bar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={link({ m: shiftMonth(-1) })} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm print:hidden">
              ←{" "}
              {new Date(`${shiftMonth(-1)}-01`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}
            </Link>
            <div className="text-center">
              <p className="font-semibold">{monthLabel}</p>
              <p className="text-xs text-slate-500">
                {monthDays.length} day{monthDays.length === 1 ? "" : "s"} worked · {fmtHours(monthMinutes)}
              </p>
            </div>
            <Link href={link({ m: shiftMonth(1) })} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm print:hidden">
              {new Date(`${shiftMonth(1)}-01`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })} →
            </Link>
          </div>
          {monthsWithWork.length > 1 && (
            <div className="flex flex-wrap gap-1.5 print:hidden">
              {monthsWithWork.map((m) => (
                <Link
                  key={m}
                  href={link({ m })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                    m === month ? "bg-slate-900 text-white" : "bg-slate-100"
                  }`}
                >
                  {new Date(`${m}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })}
                </Link>
              ))}
            </div>
          )}

          {/* Stage colour key — tap one to see who worked on it */}
          {legend.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {legend.map((l) => (
                <Link
                  key={l.key}
                  href={link({ stage: openKey === l.key ? undefined : l.key })}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${l.color.soft} ${
                    openKey === l.key ? `ring-2 ${l.color.ring}` : ""
                  }`}
                >
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ${l.color.bar}`} />
                  {l.label}
                  <span className="opacity-70" title="hours this activity ran">
                    {fmtHours(stageTotals.get(l.key) ?? 0)}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Calendar */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <th key={d} className="border border-slate-200 px-1 py-1 font-medium text-slate-500">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => {
                      if (!day) return <td key={di} className="border border-slate-200 bg-slate-50/50 h-24" />;
                      const dayMap = perDay.get(day);
                      const entries = dayMap
                        ? [...dayMap.entries()].sort((a, b) => b[1] - a[1])
                        : [];
                      const dayTotal = entries.reduce((s, [, m]) => s + m, 0);
                      const targets = planByDay.get(day) ?? [];
                      return (
                        <td
                          key={di}
                          className={`border border-slate-200 align-top p-1 h-24 ${
                            day === today ? "bg-orange-50" : isSunday(day) && entries.length === 0 ? "bg-slate-50" : ""
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className={`font-semibold ${day === today ? "text-orange-700" : "text-slate-500"}`}>
                              {dayNum(day)}
                            </span>
                            {dayTotal > 0 && (
                              <span className="text-[10px] font-semibold text-slate-600">{fmtHours(dayTotal)}</span>
                            )}
                          </div>
                          <div className="mt-0.5 space-y-0.5">
                            {entries.map(([key, mins]) => {
                              const c = key.startsWith("duty:") ? DUTY_COLOR : colorOf(key);
                              const label = keyLabel.get(key) ?? "";
                              return (
                                <Link
                                  key={key}
                                  href={link({ stage: openKey === key ? undefined : key })}
                                  className={`block rounded px-1 py-0.5 text-[10px] leading-tight ${c.soft} ${
                                    openKey === key ? `ring-1 ${c.ring}` : ""
                                  }`}
                                  title={`${label} — ${fmtHours(mins)} (tap for who worked)`}
                                >
                                  <span className="font-medium">{label}</span> {fmtHours(mins)}
                                  {runningKeys.has(key) && day === today && <span className="text-blue-700"> ▶</span>}
                                </Link>
                              );
                            })}
                            {targets.map((t) => {
                              const doneOn =
                                t.stage?.completedAt ?? (t.isDispatch ? job.completedAt : null) ?? t.doneAt;
                              const late = !doneOn && new Date(day).getTime() < Date.now() - DAY;
                              return (
                                <p
                                  key={t.id}
                                  className={`text-[10px] leading-tight ${
                                    doneOn ? "text-green-700" : late ? "text-red-600 font-medium" : "text-slate-500"
                                  }`}
                                  title={`Plan target${t.plan ? ` (${t.plan.name})` : ""}: ${
                                    t.stage ? t.stage.name : t.description
                                  }`}
                                >
                                  🎯 {(t.stage?.name ?? t.description).slice(0, 18)}
                                  {doneOn ? " ✓" : late ? " late" : ""}
                                </p>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            Each colour is one stage; the hours are how long that activity ran that day (two men
            working together for 8 hours is 8 hours, not 16). 🎯 marks a planned
            target date. Tap any stage to see who worked on it.
          </p>

          {/* Who worked on the tapped stage */}
          {openKey && (
            <div id="stage" className="rounded-xl border-2 border-slate-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  <span
                    className={`inline-block h-3 w-3 rounded-sm align-middle mr-1.5 ${
                      (openKey.startsWith("duty:") ? DUTY_COLOR : colorOf(openKey)).bar
                    }`}
                  />
                  {keyLabel.get(openKey)} — who worked on it
                </h3>
                <Link href={link({ stage: undefined })} className="text-xs text-blue-600 hover:underline print:hidden">
                  close ✕
                </Link>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                <span className="bg-slate-100 rounded px-2 py-1">
                  ran for <b>{fmtHours(stageTotals.get(openKey) ?? 0)}</b>
                </span>
                <span className="bg-slate-100 rounded px-2 py-1">
                  <b>{fmtHours(stageManMinutes.get(openKey) ?? 0)}</b> man-hours
                </span>
                <span className="bg-slate-100 rounded px-2 py-1">
                  over <b>{openDays.length}</b> day{openDays.length === 1 ? "" : "s"}
                </span>
                {(stageOt.get(openKey) ?? 0) > 0 && (
                  <span className="bg-indigo-50 text-indigo-800 rounded px-2 py-1">
                    🌙 <b>{fmtHours(stageOt.get(openKey) ?? 0)}</b> after 10 PM
                  </span>
                )}
              </div>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="py-1 pr-2">Worker</th>
                    <th className="py-1 pr-2">Days</th>
                    <th className="py-1 pr-2">Hours</th>
                    <th className="py-1">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {openWorkers.map((w) => (
                    <tr key={w.name}>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {w.name} <span className="text-xs text-slate-400">({w.skill})</span>
                      </td>
                      <td className="py-1 pr-2">{w.days.size}</td>
                      <td className="py-1 pr-2 font-medium">{fmtHours(w.minutes)}</td>
                      <td className="py-1">
                        <span
                          className="inline-block h-2 rounded bg-slate-400 align-middle"
                          style={{
                            width: `${Math.max(
                              4,
                              Math.round((w.minutes / (stageManMinutes.get(openKey) || 1)) * 100)
                            )}px`,
                          }}
                        />
                        <span className="ml-2 text-xs text-slate-500">
                          {Math.round((w.minutes / (stageManMinutes.get(openKey) || 1)) * 100)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">
                Day by day:{" "}
                {openDays
                  .map((d) => `${formatDate(new Date(d))} ${fmtHours(perDay.get(d)?.get(openKey) ?? 0)}`)
                  .join(" · ")}
              </p>
            </div>
          )}
        </>
      )}

      {/* Plan vs what actually happened */}
      {planItems.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-3">
          <h3 className="font-semibold text-sm">🎯 Plan vs actual</h3>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="py-1 pr-2">Target</th>
                  <th className="py-1 pr-2">Planned</th>
                  <th className="py-1 pr-2">Actual</th>
                  <th className="py-1 pr-2">Vs plan</th>
                  <th className="py-1">Worked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {planItems.map((p) => {
                  const doneOn =
                    p.stage?.completedAt ?? (p.isDispatch ? job.completedAt : null) ?? p.doneAt;
                  const target = p.revisedDate ?? p.targetDate;
                  // Compare calendar days in IST — finishing the day before
                  // the target is a day early, whatever the clock said.
                  const dayDiff = (a: Date, b: Date) =>
                    Math.round(
                      (new Date(istDay(a)).getTime() - new Date(istDay(b)).getTime()) / DAY
                    );
                  const diff = doneOn ? dayDiff(doneOn, target) : dayDiff(now, target);
                  const worked = p.stage ? stageTotals.get(p.stage.id) ?? 0 : 0;
                  return (
                    <tr key={p.id}>
                      <td className="py-1 pr-2">
                        {p.stage ? `${p.stage.sequence}. ${p.stage.name}` : p.description}
                        {p.isDispatch && <span className="ml-1 text-xs text-slate-400">dispatch</span>}
                        {p.lateReason && (
                          <p className="text-[11px] text-red-700">📝 {p.lateReason}</p>
                        )}
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {formatDate(p.targetDate)}
                        {p.revisedDate && (
                          <span className="block text-[11px] text-amber-700">
                            revised {formatDate(p.revisedDate)}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {doneOn ? formatDate(doneOn) : <span className="text-slate-400">not done</span>}
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {doneOn ? (
                          diff > 0 ? (
                            <span className="text-red-700 font-medium">{diff}d late</span>
                          ) : diff < 0 ? (
                            <span className="text-green-700">{-diff}d early</span>
                          ) : (
                            <span className="text-green-700">on time</span>
                          )
                        ) : diff > 0 ? (
                          <span className="text-red-700 font-medium">{diff}d overdue</span>
                        ) : (
                          <span className="text-slate-400">in {-diff}d</span>
                        )}
                      </td>
                      <td className="py-1 whitespace-nowrap">
                        {worked > 0 ? fmtHours(worked) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
