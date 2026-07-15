import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope } from "@/lib/permissions";
import { formatDate, jobCode } from "@/lib/format";
import { jobSpanBreakdown, fmtIdle } from "@/lib/idle";

export const dynamic = "force-dynamic";

// Completed-job history for comparison: planned vs actual completion,
// total calendar days, and total man-hours from the time logs — with
// averages per process template.

type HistoryRow = {
  id: string;
  jobNumber: number;
  clientName: string;
  description: string;
  unitName: string;
  templateName: string | null;
  startedAt: Date | null;
  completedAt: Date;
  expectedCompletion: Date;
  calendarDays: number | null;
  manMinutes: number;
  idleMinutes: number | null; // gap time with nobody clocked on, within the span
  daysLate: number; // negative = finished early
};

function fmtManHours(minutes: number): string {
  const h = minutes / 60;
  if (h >= 100) return `${Math.round(h)} h`;
  return `${h.toFixed(1)} h`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; template?: string; client?: string }>;
}) {
  const user = await requireUser();
  const { unit: unitFilter, template: templateFilter, client: clientFilter } =
    await searchParams;

  const [units, templates, jobs] = await Promise.all([
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.jobTemplate.findMany({ orderBy: { name: "asc" } }),
    db.job.findMany({
      where: {
        status: "COMPLETED",
        completedAt: { not: null },
        ...unitScope(user),
        ...(unitFilter ? { unitId: unitFilter } : {}),
        ...(templateFilter ? { templateId: templateFilter } : {}),
        ...(clientFilter
          ? { clientName: { contains: clientFilter, mode: "insensitive" } }
          : {}),
      },
      include: {
        unit: true,
        template: true,
        timeLogs: { select: { startedAt: true, endedAt: true } },
      },
      orderBy: { completedAt: "desc" },
      take: 500,
    }),
  ]);

  const rows: HistoryRow[] = jobs.map((job) => {
    const completedAt = job.completedAt!;
    const workStarts = job.timeLogs.map((l) => l.startedAt.getTime());
    const startedAt = workStarts.length ? new Date(Math.min(...workStarts)) : null;
    const calendarDays = startedAt
      ? Math.max(1, Math.ceil((completedAt.getTime() - startedAt.getTime()) / 86400000))
      : null;
    const manMinutes = job.timeLogs.reduce((sum, l) => {
      const end = l.endedAt ?? completedAt;
      return sum + Math.max(0, end.getTime() - l.startedAt.getTime()) / 60000;
    }, 0);
    const breakdown = jobSpanBreakdown(job.timeLogs, completedAt);
    const daysLate = Math.round(
      (completedAt.getTime() - job.expectedCompletion.getTime()) / 86400000
    );
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      description: job.description,
      unitName: job.unit.name,
      templateName: job.template?.name ?? null,
      startedAt,
      completedAt,
      expectedCompletion: job.expectedCompletion,
      calendarDays,
      manMinutes,
      idleMinutes: breakdown ? breakdown.idleMinutes : null,
      daysLate,
    };
  });

  // Averages per process template, for comparing like-for-like jobs.
  const byTemplate = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const key = r.templateName ?? "One-off (no template)";
    byTemplate.set(key, [...(byTemplate.get(key) ?? []), r]);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Completed Job History</h1>

      <form className="flex flex-wrap gap-2 bg-white rounded-xl shadow-sm p-3 text-sm">
        <select name="unit" defaultValue={unitFilter ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">All units</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select name="template" defaultValue={templateFilter ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">All processes</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          name="client"
          defaultValue={clientFilter ?? ""}
          placeholder="Search client…"
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
      </form>

      {/* Comparison summary per process */}
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...byTemplate.entries()].map(([name, list]) => {
            const withDays = list.filter((r) => r.calendarDays !== null);
            const avgDays = withDays.length
              ? withDays.reduce((s, r) => s + (r.calendarDays ?? 0), 0) / withDays.length
              : null;
            const avgHours = list.reduce((s, r) => s + r.manMinutes, 0) / list.length / 60;
            const withIdle = list.filter((r) => r.idleMinutes !== null);
            const avgIdle = withIdle.length
              ? withIdle.reduce((s, r) => s + (r.idleMinutes ?? 0), 0) / withIdle.length
              : null;
            const onTime = list.filter((r) => r.daysLate <= 0).length;
            return (
              <div key={name} className="bg-white rounded-xl shadow-sm p-4">
                <p className="font-semibold text-sm leading-tight">{name}</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                  <span><b>{list.length}</b> job{list.length === 1 ? "" : "s"}</span>
                  {avgDays !== null && <span>avg <b>{avgDays.toFixed(1)}</b> days</span>}
                  <span>avg <b>{avgHours.toFixed(1)}</b> man-hours</span>
                  {avgIdle !== null && (
                    <span>avg <b>{fmtIdle(avgIdle)}</b> idle</span>
                  )}
                  <span className={onTime === list.length ? "text-green-700" : "text-amber-700"}>
                    {onTime}/{list.length} on time
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Work started</th>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3">Man-hours</th>
              <th className="px-4 py-3">Idle</th>
              <th className="px-4 py-3">Vs plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/jobs/${r.id}`} className="font-medium text-blue-700 hover:underline">
                    {jobCode(r.jobNumber)}
                  </Link>
                  <p className="text-xs text-slate-500">{r.description}</p>
                </td>
                <td className="px-4 py-3">{r.clientName}</td>
                <td className="px-4 py-3 whitespace-nowrap">{r.unitName}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.startedAt ? formatDate(r.startedAt) : "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.completedAt)}</td>
                <td className="px-4 py-3">{r.calendarDays ?? "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{fmtManHours(r.manMinutes)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.idleMinutes === null ? (
                    "—"
                  ) : r.idleMinutes > 0 ? (
                    <span className="text-amber-700 font-medium">{fmtIdle(r.idleMinutes)}</span>
                  ) : (
                    <span className="text-green-700">none</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {r.daysLate > 0 ? (
                    <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                      {r.daysLate}d late
                    </span>
                  ) : r.daysLate < 0 ? (
                    <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                      {-r.daysLate}d early
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                      on time
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  No completed jobs yet. Once jobs are marked completed, they appear
                  here with their timings for comparison.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Days = calendar days from the first worker assignment to completion.
        Man-hours = total clocked time across all workers and stages.
        Idle = time within that span when nobody was clocked on the job
        (includes nights and holidays between shifts). Click a job for its full
        stage-by-stage timing.
      </p>
    </div>
  );
}
