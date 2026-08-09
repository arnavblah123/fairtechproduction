import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole, unitScope } from "@/lib/permissions";
import { raiseIssue, resolveIssue } from "@/lib/actions/issues";
import { IssueBadge } from "@/components/badges";
import { SearchSelect } from "@/components/search-select";
import { formatDate, formatDateTime, jobCode } from "@/lib/format";

export const dynamic = "force-dynamic";

// Supervisors ask for more hands here; HR and Purchase/HR watch this page to
// know what to hire or arrange for — same Issue row, LABOUR_SHORTAGE type,
// so it goes out on the existing WhatsApp/email alert too.
export default async function LabourRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requireRole("SUPERVISOR", "ADMIN", "SUPERADMIN", "HR", "PURCHASE_HR");
  const canRaise = user.role !== "HR" && user.role !== "PURCHASE_HR";
  const { show } = await searchParams;
  const showResolved = show === "all";

  const [requests, openJobs] = await Promise.all([
    db.issue.findMany({
      where: {
        type: "LABOUR_SHORTAGE",
        ...unitScope(user),
        ...(showResolved ? {} : { status: "OPEN" }),
      },
      include: { job: true, unit: true, raisedBy: true, resolvedBy: true },
      orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
    }),
    canRaise
      ? db.job.findMany({
          where: { ...unitScope(user), status: { not: "COMPLETED" } },
          select: { id: true, jobNumber: true, description: true, clientName: true, unit: { select: { name: true } } },
          orderBy: { jobNumber: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const jobOptions = openJobs.map((j) => ({
    value: j.id,
    label: `${jobCode(j.jobNumber)} ${j.description} — ${j.clientName} (${j.unit.name})`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Labour Requests</h1>
        <Link
          href={showResolved ? "/labour-requests" : "/labour-requests?show=all"}
          className="text-sm text-blue-600 hover:underline"
        >
          {showResolved ? "Show open only" : "Show fulfilled too"}
        </Link>
      </div>

      {canRaise && (
        <form action={raiseIssue} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <input type="hidden" name="type" value="LABOUR_SHORTAGE" />
          <h2 className="font-semibold text-sm">Request labour for a job</h2>
          {jobOptions.length === 0 ? (
            <p className="text-sm text-slate-400">No open job to request labour for yet.</p>
          ) : (
            <>
              <SearchSelect
                name="jobId"
                options={jobOptions}
                placeholder="Which job needs people?"
                required
              />
              <textarea
                name="description"
                required
                rows={2}
                placeholder="What's needed — e.g. 2 welders for 3 days"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
              />
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Needed by (optional)</label>
                  <input
                    type="date"
                    name="dueAt"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                  />
                </div>
                <button className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700">
                  Send request
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Alerts Jagdish and the owner on WhatsApp right away, and stays listed here — and
                on HR and Purchase&apos;s own Labour Requests page — until marked fulfilled.
              </p>
            </>
          )}
        </form>
      )}

      <div className="space-y-2">
        {requests.map((issue) => (
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
                    ⏳ Needed by {formatDate(issue.dueAt)}
                    {issue.status === "OPEN" && issue.dueAt < new Date() && " — overdue"}
                  </span>
                </p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
                Requested by {issue.raisedBy.name} · {formatDateTime(issue.createdAt)}
                {issue.status === "RESOLVED" &&
                  issue.resolvedAt &&
                  ` · Fulfilled by ${issue.resolvedBy?.name} ${formatDateTime(issue.resolvedAt)}`}
              </p>
            </div>
            {issue.status === "OPEN" && (
              <form action={resolveIssue}>
                <input type="hidden" name="issueId" value={issue.id} />
                <button className="rounded-lg bg-green-100 text-green-800 hover:bg-green-200 px-3 py-1.5 text-sm font-medium">
                  Mark fulfilled
                </button>
              </form>
            )}
          </div>
        ))}
        {requests.length === 0 && (
          <p className="text-slate-400 text-center py-10">
            No {showResolved ? "" : "open "}labour requests. 🎉
          </p>
        )}
      </div>
    </div>
  );
}
