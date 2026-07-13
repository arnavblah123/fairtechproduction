import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope, isAdmin } from "@/lib/permissions";
import { JobStatusBadge, IssueBadge, PriorityBadge } from "@/components/badges";
import { formatDate, jobCode } from "@/lib/format";
import type { JobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; unit?: string }>;
}) {
  const user = await requireUser();
  const { status, unit } = await searchParams;

  const [units, jobs] = await Promise.all([
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.job.findMany({
      where: {
        ...unitScope(user),
        ...(status ? { status: status as JobStatus } : {}),
        ...(unit ? { unitId: unit } : {}),
      },
      include: {
        unit: true,
        stages: true,
        issues: { where: { status: "OPEN" } },
      },
      orderBy: [{ priority: "desc" }, { expectedCompletion: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Jobs</h1>
        {isAdmin(user) && (
          <Link
            href="/jobs/new"
            className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            + New Job
          </Link>
        )}
      </div>

      <form className="flex flex-wrap gap-2 bg-white rounded-xl shadow-sm p-3 text-sm">
        <select name="unit" defaultValue={unit ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">All units</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">All statuses</option>
          <option value="NOT_STARTED">Not Started</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="ON_HOLD">On Hold</option>
          <option value="COMPLETED">Completed</option>
        </select>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Progress</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job) => {
              const done = job.stages.filter((s) => s.status === "DONE").length;
              return (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/jobs/${job.id}`} className="font-medium text-blue-700 hover:underline">
                      {jobCode(job.jobNumber)}
                    </Link>
                    <p className="text-xs text-slate-500">{job.description}</p>
                  </td>
                  <td className="px-4 py-3">{job.clientName}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{job.unit.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(job.expectedCompletion)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {done}/{job.stages.length} stages
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <JobStatusBadge status={job.status} />
                      {job.priority && <PriorityBadge />}
                      {job.issues.length > 0 && <IssueBadge count={job.issues.length} />}
                    </div>
                  </td>
                </tr>
              );
            })}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No jobs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
