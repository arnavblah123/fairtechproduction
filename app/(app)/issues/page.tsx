import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope, allowPurchaseHr} from "@/lib/permissions";
import { resolveIssue } from "@/lib/actions/issues";
import { IssueBadge } from "@/components/badges";
import { ActionButton, PendingSubmit } from "@/components/instant";
import { raiseGeneralIssue, resolveGeneralIssue } from "@/lib/actions/general-issues";
import { formatDate, formatDateTime, jobCode } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requireUser();
  allowPurchaseHr(user); // Purchase/HR may see this page
  const { show } = await searchParams;
  const showResolved = show === "all";

  const [issues, generalIssues, units] = await Promise.all([
    db.issue.findMany({
      where: {
        ...unitScope(user),
        ...(showResolved ? {} : { status: "OPEN" }),
      },
      include: { job: true, unit: true, raisedBy: true, resolvedBy: true },
      // Soonest deadline first — what purchase must chase today sits on top.
      orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    }),
    // Factory-level problems (no job): unit-scoped ones for the user's units,
    // plus company-wide ones (unitId null) for everyone.
    db.generalIssue.findMany({
      where: {
        ...(showResolved ? {} : { status: "OPEN" }),
        ...(user.role === "SUPERADMIN" || user.role === "PURCHASE_HR"
          ? {}
          : { OR: [{ unitId: null }, { unitId: { in: user.unitIds } }] }),
      },
      include: { unit: true, raisedBy: true, resolvedBy: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.unit.findMany({
      where: user.role === "SUPERADMIN" || user.role === "PURCHASE_HR" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Issues</h1>
        <Link
          href={showResolved ? "/issues" : "/issues?show=all"}
          className="text-sm text-blue-600 hover:underline"
        >
          {showResolved ? "Show open only" : "Show resolved too"}
        </Link>
      </div>

      {/* Factory-level problems — anything that belongs to no job */}
      <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold text-sm">🏭 Factory problem — electricity, crane calling, water, anything</h2>
        <form action={raiseGeneralIssue} className="flex flex-wrap items-center gap-2">
          <input
            name="description"
            required
            placeholder="What's the problem? e.g. Power gone at Dehu since 10 AM"
            className="flex-1 min-w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
          />
          <select
            name="unitId"
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
            title="Which unit is affected"
          >
            <option value="">All units / general</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <PendingSubmit
            className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-60"
            busy="Raising…"
          >
            🚨 Raise it
          </PendingSubmit>
        </form>
        {generalIssues.length > 0 && (
          <div className="space-y-2 pt-1">
            {generalIssues.map((g) => (
              <div
                key={g.id}
                className={`rounded-lg border px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2 ${
                  g.status === "OPEN" ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-200 text-slate-500"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium">{g.description}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {g.unit?.name ?? "All units"} · {g.raisedBy.name} · {formatDateTime(g.createdAt)}
                    {g.status === "RESOLVED" &&
                      g.resolvedAt &&
                      ` · Resolved by ${g.resolvedBy?.name} ${formatDateTime(g.resolvedAt)}`}
                  </p>
                </div>
                {g.status === "OPEN" && (
                  <ActionButton
                    action={resolveGeneralIssue}
                    fields={{ issueId: g.id }}
                    className="rounded-lg bg-green-100 text-green-800 hover:bg-green-200 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                    optimistic="✓ Resolved"
                  >
                    Resolve
                  </ActionButton>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-2">
        {issues.map((issue) => (
          <div
            key={issue.id}
            className={`rounded-xl shadow-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2 ${
              issue.status === "OPEN" ? "bg-white border-l-4 border-red-500" : "bg-slate-50 text-slate-500"
            }`}
          >
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <IssueBadge type={issue.type} />
                <Link href={`/jobs/${issue.jobId}`} className="text-sm font-medium text-blue-700 hover:underline">
                  {jobCode(issue.job.jobNumber)} · {issue.job.clientName}
                </Link>
                <span className="text-xs text-slate-400">{issue.unit.name}</span>
              </div>
              <p className="text-sm mt-1">{issue.description}</p>
              {issue.dueAt && (
                <p className="text-xs mt-0.5">
                  <span
                    className={
                      issue.status === "OPEN" && issue.dueAt < new Date()
                        ? "text-red-600 font-semibold"
                        : "text-slate-500"
                    }
                  >
                    ⏳ Resolve by {formatDate(issue.dueAt)}
                    {issue.status === "OPEN" && issue.dueAt < new Date() && " — overdue"}
                  </span>
                </p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
                Raised by {issue.raisedBy.name} · {formatDateTime(issue.createdAt)}
                {issue.status === "RESOLVED" &&
                  issue.resolvedAt &&
                  ` · Resolved by ${issue.resolvedBy?.name} ${formatDateTime(issue.resolvedAt)}`}
              </p>
            </div>
            {issue.status === "OPEN" && (
              <ActionButton
                action={resolveIssue}
                fields={{ issueId: issue.id }}
                className="rounded-lg bg-green-100 text-green-800 hover:bg-green-200 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                optimistic="✓ Resolved"
              >
                Resolve
              </ActionButton>
            )}
          </div>
        ))}
        {issues.length === 0 && (
          <p className="text-slate-400 text-center py-10">
            No {showResolved ? "" : "open "}issues. 🎉
          </p>
        )}
      </div>
    </div>
  );
}
