import Link from "next/link";
import { db } from "@/lib/db";
import { istToday } from "@/lib/overheads";
import { formatDateTime, jobCode } from "@/lib/format";
import { acknowledgeFinding } from "@/lib/actions/findings";

// What the monitoring agent found today. Rendered only after the caller has
// already checked the role — see the dashboard, which does not even import
// this for anyone but the owner.
const TONE: Record<string, string> = {
  high: "bg-red-50 border-red-200 text-red-900",
  medium: "bg-amber-50 border-amber-200 text-amber-900",
  low: "bg-slate-50 border-slate-200 text-slate-700",
};
const ICON: Record<string, string> = { high: "🔴", medium: "🟠", low: "⚪️" };

export async function DailyFindings() {
  const today = istToday();
  const yesterday = new Date(today.getTime() - 86400000);
  // If the daily_findings table is ever a beat behind the deployed code (a
  // migration lag, a transient connection issue), this panel must disappear
  // quietly rather than take the whole dashboard down with it.
  const findings = await db.dailyFinding
    .findMany({
      where: { day: { gte: yesterday }, acknowledged: false },
      include: { job: { select: { id: true, jobNumber: true, description: true } } },
      orderBy: [{ runAt: "desc" }],
      take: 25,
    })
    .catch((e) => {
      console.error("daily findings query failed:", e);
      return [];
    });
  if (findings.length === 0) return null;

  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const sorted = [...findings].sort(
    (a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3)
  );
  const lastRun = findings[0].runAt;

  return (
    <section className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          🤖 What the monitor found{" "}
          <span className="text-sm font-normal text-slate-500">
            ({findings.length}, last checked {formatDateTime(lastRun)})
          </span>
        </h2>
        <Link href="/assistant" className="text-sm text-blue-600 hover:underline">
          Ask a question →
        </Link>
      </div>
      {sorted.map((f) => (
        <div key={f.id} className={`rounded-lg border px-3 py-2 text-sm ${TONE[f.severity] ?? TONE.low}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium">
              {ICON[f.severity] ?? "•"} {f.title}
            </p>
            <form action={acknowledgeFinding}>
              <input type="hidden" name="findingId" value={f.id} />
              <button className="text-xs opacity-60 hover:opacity-100" title="Seen — hide it">
                ✕
              </button>
            </form>
          </div>
          <p className="mt-0.5">{f.detail}</p>
          {f.job ? (
            <Link
              href={`/jobs/${f.job.id}`}
              className="text-xs underline underline-offset-2 mt-0.5 inline-block"
            >
              {jobCode(f.job.jobNumber)} {f.job.description} →
            </Link>
          ) : f.reference ? (
            <p className="text-xs opacity-70 mt-0.5">{f.reference}</p>
          ) : null}
        </div>
      ))}
      <p className="text-[11px] text-slate-400">
        Checked automatically at 11 AM and 4 PM against the checklist in
        config/monitor-checklist.md.
      </p>
    </section>
  );
}
