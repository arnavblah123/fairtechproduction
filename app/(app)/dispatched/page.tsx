import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, isAdmin, lockHrToLabour } from "@/lib/permissions";
import { reopenJob } from "@/lib/actions/jobs";
import { ActionButton } from "@/components/instant";
import { formatDate, formatMoney, jobCode } from "@/lib/format";

export const dynamic = "force-dynamic";

// Dispatched jobs — the work that has left the factory, unit-wise. Open to
// supervisors: the dashboard drops a job the moment it is dispatched, and
// until now the only way back to one was the Jobs filter or the History
// table. Reversing a dispatch stays with admins.
export default async function DispatchedPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; client?: string }>;
}) {
  const user = await requireUser();
  lockHrToLabour(user);
  const admin = isAdmin(user);
  const owner = user.role === "SUPERADMIN";
  const { unit: unitFilter, client: clientFilter } = await searchParams;

  const [units, jobs] = await Promise.all([
    db.unit.findMany({
      where: owner ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.job.findMany({
      where: {
        status: "COMPLETED",
        ...(owner ? {} : { unitId: { in: user.unitIds } }),
        ...(unitFilter ? { unitId: unitFilter } : {}),
        ...(clientFilter
          ? { clientName: { contains: clientFilter, mode: "insensitive" } }
          : {}),
      },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        buyerName: true,
        description: true,
        unitId: true,
        poNumber: true,
        poValue: true,
        completedAt: true,
        expectedCompletion: true,
      },
      orderBy: { completedAt: "desc" },
      take: 200,
    }),
  ]);

  const groups = units
    .filter((u) => !unitFilter || u.id === unitFilter)
    .map((u) => ({ unit: u, jobs: jobs.filter((j) => j.unitId === u.id) }))
    .filter((g) => g.jobs.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">🚚 Dispatched</h1>
        <p className="text-sm text-slate-500">
          {jobs.length} job{jobs.length === 1 ? "" : "s"} that have left the
          factory — newest first
        </p>
      </div>

      <form className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-2 text-sm">
        {units.length > 1 && (
          <label className="flex flex-col">
            <span className="text-xs text-slate-500 mb-1">Unit</span>
            <select
              name="unit"
              defaultValue={unitFilter ?? ""}
              className="rounded-lg border border-slate-300 px-3 py-1.5"
            >
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Client</span>
          <input
            name="client"
            defaultValue={clientFilter ?? ""}
            placeholder="Search client…"
            className="rounded-lg border border-slate-300 px-3 py-1.5"
          />
        </label>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
      </form>

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center space-y-2">
          <p className="text-3xl">🚚</p>
          <h2 className="font-semibold">Nothing dispatched yet</h2>
          <p className="text-sm text-slate-600">
            Jobs appear here once they are marked <b>Dispatched ✓</b> from the
            Ready to Dispatch list.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 items-start">
          {groups.map(({ unit, jobs: unitJobs }) => (
            <section key={unit.id} className="bg-white rounded-xl shadow-sm">
              <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{unit.name}</h2>
                  <p className="text-xs text-slate-500">{unit.location}</p>
                </div>
                <span className="text-sm text-slate-500">
                  {unitJobs.length} dispatched
                </span>
              </header>
              <div className="px-4 py-3 space-y-2">
                {unitJobs.map((job) => {
                  // Late is judged against the date promised at creation.
                  const late =
                    job.completedAt !== null &&
                    job.completedAt.getTime() > job.expectedCompletion.getTime();
                  return (
                    <div key={job.id} className="bg-green-50 rounded-lg p-3 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="font-medium text-sm hover:underline"
                        >
                          {job.description}
                          <span className="block text-xs text-slate-500 font-normal">
                            {jobCode(job.jobNumber)} · {job.clientName}
                            {job.buyerName && <> · for {job.buyerName}</>}
                          </span>
                        </Link>
                        {job.completedAt && (
                          <span
                            className={`text-xs whitespace-nowrap font-medium ${
                              late ? "text-red-700" : "text-green-800"
                            }`}
                          >
                            {formatDate(job.completedAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {job.poNumber && <>PO {job.poNumber} · </>}
                        promised {formatDate(job.expectedCompletion)}
                        {late && <span className="text-red-700"> · late</span>}
                        {owner && job.poValue ? <> · {formatMoney(job.poValue)}</> : null}
                      </p>
                      {admin && (
                        <ActionButton
                          action={reopenJob}
                          fields={{ jobId: job.id }}
                          className="text-xs font-medium text-blue-700 hover:underline"
                          optimistic="↩ Reopening…"
                          title="Dispatched by mistake — puts the job back in Ready to Dispatch"
                        >
                          ↩ Reverse this dispatch
                        </ActionButton>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
