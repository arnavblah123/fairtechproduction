import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope, allowPurchaseHr } from "@/lib/permissions";
import { jobCode, formatDate } from "@/lib/format";
import { otOverlapMinutes } from "@/lib/ot";
import { SearchSelect } from "@/components/search-select";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

// Job Work Calendar — the time logs turned into a calendar. Pick a job and
// see, day by day, who worked on which stage and for how long. Nothing is
// planned or entered here: every figure comes from the clocks the
// supervisors already run on the shop floor.

const DAY = 86400000;
const IST_MS = 5.5 * 3600e3;

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayStartInstant = (day: string) => new Date(new Date(day).getTime() - IST_MS);
const isSunday = (day: string) => new Date(day).getUTCDay() === 0;
const dayNum = (day: string) => Number(day.slice(8, 10));

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  if (h >= 10) return `${Math.round(h)}h`;
  return `${h.toFixed(1)}h`;
}

// Split one clocked session across the IST days it spans, so a night shift
// lands partly on each date instead of all on the day it started.
function splitByDay(start: Date, end: Date): { day: string; minutes: number }[] {
  const out: { day: string; minutes: number }[] = [];
  let t = start.getTime();
  const stop = end.getTime();
  let guard = 0;
  while (t < stop && guard++ < 40) {
    const day = istDay(new Date(t));
    const nextMidnight = dayStartInstant(day).getTime() + DAY;
    const chunkEnd = Math.min(stop, nextMidnight);
    out.push({ day, minutes: (chunkEnd - t) / 60000 });
    t = chunkEnd;
  }
  return out;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; m?: string }>;
}) {
  const user = await requireUser();
  allowPurchaseHr(user);
  const { job: jobParam, m: monthParam } = await searchParams;

  const jobs = await db.job.findMany({
    where: unitScope(user),
    select: {
      id: true,
      jobNumber: true,
      description: true,
      clientName: true,
      status: true,
      unit: { select: { code: true } },
    },
    orderBy: { jobNumber: "desc" },
    take: 300,
  });

  const jobId = jobParam ?? jobs[0]?.id;
  const job = jobId
    ? await db.job.findUnique({
        where: { id: jobId },
        include: { unit: { select: { name: true } } },
      })
    : null;

  if (!job) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">📅 Job Work Calendar</h1>
        <p className="text-slate-400">No jobs yet.</p>
      </div>
    );
  }

  const logs = await db.timeLog.findMany({
    where: { jobId: job.id },
    include: {
      employee: { select: { id: true, name: true, skill: true } },
      stage: { select: { id: true, name: true, sequence: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  const now = new Date();
  type Entry = {
    employeeId: string;
    name: string;
    skill: string;
    activity: string;
    minutes: number;
    otMinutes: number;
    running: boolean;
  };
  // day → employee|activity → entry
  const byDay = new Map<string, Map<string, Entry>>();
  for (const l of logs) {
    const end = l.endedAt ?? now;
    const activity = l.stage
      ? `${l.stage.sequence}. ${l.stage.name}`
      : l.activity === "STAGE"
      ? "Job work"
      : l.activity.replace(/_/g, " ").toLowerCase();
    for (const part of splitByDay(l.startedAt, end)) {
      if (part.minutes <= 0) continue;
      const dayMap = byDay.get(part.day) ?? new Map<string, Entry>();
      const key = `${l.employee.id}|${activity}`;
      const rec =
        dayMap.get(key) ??
        {
          employeeId: l.employee.id,
          name: l.employee.name,
          skill: l.employee.skill,
          activity,
          minutes: 0,
          otMinutes: 0,
          running: false,
        };
      rec.minutes += part.minutes;
      // OT = the part of this session after 10 PM, clipped to this day's window
      const w0 = dayStartInstant(part.day);
      rec.otMinutes += otOverlapMinutes(
        l.startedAt,
        end,
        new Date(w0.getTime() + 22 * 3600e3),
        new Date(w0.getTime() + 30 * 3600e3)
      );
      if (!l.endedAt) rec.running = true;
      dayMap.set(key, rec);
      byDay.set(part.day, dayMap);
    }
  }

  const workedDays = [...byDay.keys()].sort();
  const totalMinutes = [...byDay.values()].reduce(
    (s, m) => s + [...m.values()].reduce((a, e) => a + e.minutes, 0),
    0
  );
  const otMinutes = [...byDay.values()].reduce(
    (s, m) => s + [...m.values()].reduce((a, e) => a + e.otMinutes, 0),
    0
  );

  // Which month to show: the one asked for, else the latest month with work.
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
  const prevMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);
  const monthsWithWork = [...new Set(workedDays.map((d) => d.slice(0, 7)))];

  // Calendar grid: whole weeks (Mon–Sun) covering the month.
  const firstOfMonth = monthStart;
  const daysInMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const leading = (firstOfMonth.getUTCDay() + 6) % 7; // Mon = 0
  const cells: (string | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthDays = workedDays.filter((d) => d.startsWith(month));
  const monthMinutes = monthDays.reduce(
    (s, d) => s + [...(byDay.get(d) ?? new Map()).values()].reduce((a, e) => a + e.minutes, 0),
    0
  );
  const today = istDay(now);

  // Per-worker totals for this month — who put in how much.
  const workerTotals = new Map<string, { name: string; skill: string; minutes: number; days: Set<string> }>();
  for (const d of monthDays) {
    for (const e of (byDay.get(d) ?? new Map<string, Entry>()).values()) {
      const rec =
        workerTotals.get(e.employeeId) ??
        { name: e.name, skill: e.skill, minutes: 0, days: new Set<string>() };
      rec.minutes += e.minutes;
      rec.days.add(d);
      workerTotals.set(e.employeeId, rec);
    }
  }
  const workers = [...workerTotals.values()].sort((a, b) => b.minutes - a.minutes);

  const qs = (over: Record<string, string>) =>
    "?" + new URLSearchParams({ job: job.id, m: month, ...over }).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-xl font-bold">📅 Job Work Calendar</h1>
        <PrintButton />
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
              label: `${j.description} — ${j.clientName} (${jobCode(j.jobNumber)} · ${j.unit.code})${
                j.status === "COMPLETED" ? " ✓" : ""
              }`,
            }))}
          />
        </div>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Show</button>
      </form>

      {/* Job header + totals */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-bold">
              {job.description}{" "}
              <span className="font-normal text-slate-400 text-sm">{jobCode(job.jobNumber)}</span>
            </p>
            <p className="text-sm text-slate-500">
              {job.clientName} · {job.unit.name} · promised {formatDate(job.expectedCompletion)}
            </p>
          </div>
          <Link href={`/jobs/${job.id}`} className="text-sm text-blue-600 hover:underline print:hidden">
            Open job →
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="bg-slate-50 rounded-lg px-3 py-1.5">
            <b>{fmtHours(totalMinutes)}</b> total man-hours
          </span>
          <span className="bg-slate-50 rounded-lg px-3 py-1.5">
            worked on <b>{workedDays.length}</b> day{workedDays.length === 1 ? "" : "s"}
          </span>
          {workedDays.length > 0 && (
            <span className="bg-slate-50 rounded-lg px-3 py-1.5">
              {formatDate(new Date(workedDays[0]))} → {formatDate(new Date(workedDays[workedDays.length - 1]))}
            </span>
          )}
          {otMinutes > 0 && (
            <span className="bg-indigo-50 text-indigo-800 rounded-lg px-3 py-1.5">
              🌙 <b>{fmtHours(otMinutes)}</b> after 10 PM
            </span>
          )}
        </div>
      </div>

      {workedDays.length === 0 ? (
        <p className="bg-white rounded-xl shadow-sm p-8 text-center text-slate-400">
          Nobody has been clocked on this job yet — the calendar fills itself as work is logged.
        </p>
      ) : (
        <>
          {/* Month navigation */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl shadow-sm p-3">
            <Link
              href={qs({ m: prevMonth })}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm print:hidden"
            >
              ← {new Date(`${prevMonth}-01`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}
            </Link>
            <div className="text-center">
              <p className="font-semibold">{monthLabel}</p>
              <p className="text-xs text-slate-500">
                {monthDays.length} working day{monthDays.length === 1 ? "" : "s"} · {fmtHours(monthMinutes)}
              </p>
            </div>
            <Link
              href={qs({ m: nextMonth })}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm print:hidden"
            >
              {new Date(`${nextMonth}-01`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })} →
            </Link>
          </div>
          {monthsWithWork.length > 1 && (
            <div className="flex flex-wrap gap-1.5 print:hidden">
              {monthsWithWork.map((m) => (
                <Link
                  key={m}
                  href={qs({ m })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                    m === month ? "bg-slate-900 text-white" : "bg-white shadow-sm"
                  }`}
                >
                  {new Date(`${m}-01`).toLocaleDateString("en-IN", {
                    month: "short",
                    year: "2-digit",
                    timeZone: "UTC",
                  })}
                </Link>
              ))}
            </div>
          )}

          {/* The calendar */}
          <div className="bg-white rounded-xl shadow-sm p-2 sm:p-3 overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <th
                      key={d}
                      className={`border border-slate-200 px-1 py-1 font-medium ${
                        d === "Sun" ? "bg-slate-100 text-slate-500" : "text-slate-500"
                      }`}
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => {
                      if (!day) {
                        return <td key={di} className="border border-slate-200 bg-slate-50/50 h-24" />;
                      }
                      const entries = [...(byDay.get(day) ?? new Map<string, Entry>()).values()].sort(
                        (a, b) => b.minutes - a.minutes
                      );
                      const dayMinutes = entries.reduce((s, e) => s + e.minutes, 0);
                      return (
                        <td
                          key={di}
                          className={`border border-slate-200 align-top p-1 h-24 ${
                            day === today
                              ? "bg-orange-50"
                              : entries.length > 0
                              ? "bg-green-50/60"
                              : isSunday(day)
                              ? "bg-slate-100"
                              : ""
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span
                              className={`font-semibold ${
                                day === today ? "text-orange-700" : "text-slate-600"
                              }`}
                            >
                              {dayNum(day)}
                            </span>
                            {dayMinutes > 0 && (
                              <span className="rounded bg-green-600 text-white px-1 text-[10px] font-medium">
                                {fmtHours(dayMinutes)}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 space-y-0.5">
                            {entries.slice(0, 4).map((e, i) => (
                              <p key={i} className="leading-tight text-[10px]" title={`${e.name} — ${e.activity} — ${fmtHours(e.minutes)}`}>
                                <span className="font-medium">{e.name.split(" ")[0]}</span>{" "}
                                <span className="text-slate-500">{e.activity}</span>{" "}
                                <span className="text-green-800">{fmtHours(e.minutes)}</span>
                                {e.running && <span className="text-blue-600"> ▶</span>}
                                {e.otMinutes > 0 && <span title="worked after 10 PM"> 🌙</span>}
                              </p>
                            ))}
                            {entries.length > 4 && (
                              <p className="text-[10px] text-slate-400">+{entries.length - 4} more</p>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500 mt-2">
              Every entry comes from the clocks run on the shop floor — name, what they were on,
              and hours. ▶ means still clocked on, 🌙 means part of it was after 10 PM.
            </p>
          </div>

          {/* Who worked how much this month */}
          {workers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-2">👷 Who worked on it — {monthLabel}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="px-2 py-2">Worker</th>
                      <th className="px-2 py-2">Days</th>
                      <th className="px-2 py-2">Hours</th>
                      <th className="px-2 py-2">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {workers.map((w) => (
                      <tr key={w.name}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {w.name} <span className="text-slate-400 text-xs">({w.skill})</span>
                        </td>
                        <td className="px-2 py-1.5">{w.days.size}</td>
                        <td className="px-2 py-1.5 font-medium">{fmtHours(w.minutes)}</td>
                        <td className="px-2 py-1.5">
                          <span className="inline-block h-2 rounded bg-green-500 align-middle"
                            style={{ width: `${Math.max(4, Math.round((w.minutes / monthMinutes) * 120))}px` }} />
                          <span className="ml-2 text-xs text-slate-500">
                            {Math.round((w.minutes / monthMinutes) * 100)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Day by day, newest first */}
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h2 className="font-semibold mb-2">🗓️ Day by day — {monthLabel}</h2>
            {monthDays.length === 0 ? (
              <p className="text-sm text-slate-400">No work logged in this month.</p>
            ) : (
              <div className="space-y-2">
                {[...monthDays].reverse().map((d) => {
                  const entries = [...(byDay.get(d) ?? new Map<string, Entry>()).values()].sort(
                    (a, b) => b.minutes - a.minutes
                  );
                  const total = entries.reduce((s, e) => s + e.minutes, 0);
                  return (
                    <div key={d} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="text-sm font-medium">
                        {formatDate(new Date(d))}
                        <span className="ml-2 text-xs text-slate-500">
                          {fmtHours(total)} · {new Set(entries.map((e) => e.employeeId)).size} worker
                          {new Set(entries.map((e) => e.employeeId)).size === 1 ? "" : "s"}
                        </span>
                      </p>
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {entries.map((e, i) => (
                          <li key={i} className="flex flex-wrap justify-between gap-2">
                            <span>
                              <b>{e.name}</b>{" "}
                              <span className="text-slate-500">— {e.activity}</span>
                              {e.running && (
                                <span className="ml-1 text-xs text-blue-600">still on</span>
                              )}
                            </span>
                            <span className="whitespace-nowrap">
                              {fmtHours(e.minutes)}
                              {e.otMinutes > 0 && (
                                <span className="ml-1 text-xs text-indigo-700">
                                  🌙 {fmtHours(e.otMinutes)}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
