import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope } from "@/lib/permissions";
import { resolveIssue } from "@/lib/actions/issues";
import { IssueBadge } from "@/components/badges";
import { formatDateTime, jobCode } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requireUser();
  const { show } = await searchParams;
  const showResolved = show === "all";

  const issues = await db.issue.findMany({
    where: {
      ...unitScope(user),
      ...(showResolved ? {} : { status: "OPEN" }),
    },
    include: { job: true, unit: true, raisedBy: true, resolvedBy: true },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

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
              <p className="text-xs text-slate-400 mt-0.5">
                Raised by {issue.raisedBy.name} · {formatDateTime(issue.createdAt)}
                {issue.status === "RESOLVED" &&
                  issue.resolvedAt &&
                  ` · Resolved by ${issue.resolvedBy?.name} ${formatDateTime(issue.resolvedAt)}`}
              </p>
            </div>
            {issue.status === "OPEN" && (
              <form action={resolveIssue}>
                <input type="hidden" name="issueId" value={issue.id} />
                <button className="rounded-lg bg-green-100 text-green-800 hover:bg-green-200 px-3 py-1.5 text-sm font-medium">
                  Resolve
                </button>
              </form>
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
