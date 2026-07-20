import Link from "next/link";
import { headers } from "next/headers";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { formatDate, jobCode } from "@/lib/format";
import { JobStatusBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

// Owner-only planner: private calendar feed, delivery scorecard (on time vs
// late), and the deadline pipeline. Not linked anywhere supervisors or
// admins can see, and the route itself refuses non-superadmins.

const DAY = 86400000;

// Late = completed after the end of the promised day.
function isOnTime(completedAt: Date, expected: Date): boolean {
  return completedAt.getTime() < expected.getTime() + DAY;
}

export default async function PlannerPage() {
  await requireRole("SUPERADMIN");

  // Private feed token — created on first visit.
  let tokenRow = await db.setting.findUnique({ where: { key: "calendar.feedToken" } });
  if (!tokenRow) {
    tokenRow = await db.setting.create({
      data: { key: "calendar.feedToken", value: crypto.randomBytes(24).toString("hex") },
    });
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "fairtechproduction.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const feedUrl = `${proto}://${host}/api/feed/${tokenRow.value}`;

  const [completed, open, units] = await Promise.all([
    db.job.findMany({
      where: { status: "COMPLETED", completedAt: { not: null } },
      include: { unit: { select: { name: true, code: true } } },
      orderBy: { completedAt: "desc" },
    }),
    db.job.findMany({
      where: { status: { not: "COMPLETED" } },
      include: { unit: { select: { name: true, code: true } } },
      orderBy: { expectedCompletion: "asc" },
    }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
  ]);

  const now = Date.now();
  const scored = completed.map((j) => ({
    job: j,
    onTime: isOnTime(j.completedAt!, j.expectedCompletion),
    daysLate: Math.max(
      0,
      Math.floor((j.completedAt!.getTime() - j.expectedCompletion.getTime()) / DAY)
    ),
  }));
  const lateJobs = scored.filter((s) => !s.onTime);
  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

  const perUnit = units.map((u) => {
    const list = scored.filter((s) => s.job.unit.code === u.code);
    return {
      name: u.name,
      total: list.length,
      onTime: list.filter((s) => s.onTime).length,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Owner&apos;s Planner</h1>
        <span className="text-xs bg-slate-900 text-white rounded-full px-3 py-1">
          Visible only to you
        </span>
      </div>

      {/* Private calendar feed */}
      <section className="bg-white rounded-xl shadow-sm p-4 space-y-2">
        <h2 className="font-semibold">Your private calendar (auto-updating)</h2>
        <p className="text-sm text-slate-600">
          Add this secret address to Google Calendar once —{" "}
          <b>calendar.google.com → Other calendars → + → From URL</b> — and every
          job deadline (⏰ with reminder) and estimated dispatch date (🚚)
          appears in your calendar and stays in sync automatically. Keep the
          link to yourself; anyone with it can read the schedule.
        </p>
        <input
          readOnly
          defaultValue={feedUrl}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono"
        />
        <p className="text-xs text-slate-400">
          Google refreshes subscribed calendars every few hours. For instant
          per-event push we can wire the Google service account later (README
          &quot;Google Calendar&quot;).
        </p>
      </section>

      {/* Delivery scorecard */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-slate-500">Completed jobs</p>
          <p className="text-2xl font-bold">{scored.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-slate-500">On time</p>
          <p className="text-2xl font-bold text-green-700">
            {scored.length - lateJobs.length}
            <span className="text-sm font-medium text-slate-400 ml-2">
              {pct(scored.length - lateJobs.length, scored.length)}
            </span>
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-slate-500">Late</p>
          <p className="text-2xl font-bold text-red-700">{lateJobs.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <p className="text-xs text-slate-500">By unit (on time / completed)</p>
          <div className="mt-1 space-y-0.5 text-sm">
            {perUnit.map((u) => (
              <p key={u.name} className="flex justify-between">
                <span className="text-slate-600">{u.name}</span>
                <b className={u.onTime === u.total ? "text-green-700" : "text-amber-700"}>
                  {u.onTime}/{u.total}
                </b>
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Late jobs — which ones and by how much */}
      {lateJobs.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-2">Delivered late</h2>
          <ul className="space-y-1.5">
            {lateJobs.map(({ job, daysLate }) => (
              <li key={job.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/jobs/${job.id}`} className="font-medium text-blue-700 hover:underline">
                  {jobCode(job.jobNumber)}
                </Link>
                <span>{job.clientName} — {job.description}</span>
                <span className="text-xs text-slate-400">{job.unit.code}</span>
                <span className="ml-auto inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                  {daysLate}d late
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pipeline: everything not yet completed, by deadline */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-2">Deadline pipeline</h2>
        <ul className="divide-y divide-slate-100">
          {open.map((job) => {
            const daysLeft = Math.ceil((job.expectedCompletion.getTime() - now) / DAY);
            const dispatchSlipping =
              job.status === "READY_TO_DISPATCH" &&
              job.estimatedDispatchAt &&
              job.estimatedDispatchAt.getTime() + DAY < now;
            return (
              <li key={job.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/jobs/${job.id}`} className="font-medium text-blue-700 hover:underline">
                  {jobCode(job.jobNumber)}
                </Link>
                <span>{job.clientName} — {job.description}</span>
                <span className="text-xs text-slate-400">{job.unit.code}</span>
                <JobStatusBadge status={job.status} />
                {job.estimatedDispatchAt && (
                  <span className={`text-xs ${dispatchSlipping ? "text-red-700 font-semibold" : "text-cyan-700"}`}>
                    🚚 {formatDate(job.estimatedDispatchAt)}
                    {dispatchSlipping ? " — SLIPPING" : ""}
                  </span>
                )}
                <span
                  className={`ml-auto inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    daysLeft < 0
                      ? "bg-red-100 text-red-800"
                      : daysLeft <= 7
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {daysLeft < 0
                    ? `overdue ${-daysLeft}d`
                    : daysLeft === 0
                    ? "due today"
                    : `${daysLeft}d left · ${formatDate(job.expectedCompletion)}`}
                </span>
              </li>
            );
          })}
          {open.length === 0 && (
            <li className="py-6 text-center text-slate-400 text-sm">No open jobs.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
