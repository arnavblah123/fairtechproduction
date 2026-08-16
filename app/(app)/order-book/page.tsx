import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, isAdmin, lockHrToLabour } from "@/lib/permissions";
import { deleteFutureJob } from "@/lib/actions/planning";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// The order book: work the company has taken on but not yet released to a
// unit's board. Listed unit-wise, because the first question about an order
// is always which shop is going to build it.
export default async function OrderBookPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const user = await requireUser();
  lockHrToLabour(user);
  const admin = isAdmin(user);
  const { unit: unitFilter } = await searchParams;

  const [units, orders] = await Promise.all([
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.futureJob.findMany({
      where: {
        ...(user.role === "SUPERADMIN"
          ? {}
          : { OR: [{ unitId: null }, { unitId: { in: user.unitIds } }] }),
        ...(unitFilter ? { unitId: unitFilter } : {}),
      },
      include: { addedBy: { select: { name: true } } },
      orderBy: [{ priority: "desc" }, { expectedCompletion: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  // Unit-wise groups, with anything not yet routed to a shop at the end.
  const groups = units
    .filter((u) => !unitFilter || u.id === unitFilter)
    .map((u) => ({ id: u.id, name: u.name, location: u.location as string | null, orders: orders.filter((o) => o.unitId === u.id) }))
    .concat(
      orders.some((o) => !o.unitId)
        ? [
            {
              id: "none",
              name: "Unit not decided",
              location: null,
              orders: orders.filter((o) => !o.unitId),
            },
          ]
        : []
    )
    .filter((g) => g.orders.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">📒 Order Book</h1>
          <p className="text-sm text-slate-500">
            {orders.length} order{orders.length === 1 ? "" : "s"} booked and not
            yet in production
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="rounded-lg bg-amber-600 text-white px-4 py-2 text-sm font-medium"
        >
          + Book an order
        </Link>
      </div>

      {units.length > 1 && (
        <form className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-2 text-sm">
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
          <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
        </form>
      )}

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center space-y-2">
          <p className="text-3xl">📒</p>
          <h2 className="font-semibold">Nothing booked yet</h2>
          <p className="text-sm text-slate-600">
            Add a job and choose <b>Order book</b> instead of Production to park
            work here until a unit is ready for it.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 items-start">
          {groups.map((g) => (
            <section key={g.id} className="bg-white rounded-xl shadow-sm">
              <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{g.name}</h2>
                  {g.location && <p className="text-xs text-slate-500">{g.location}</p>}
                </div>
                <span className="text-sm text-slate-500">
                  {g.orders.length} order{g.orders.length === 1 ? "" : "s"}
                </span>
              </header>
              <div className="px-4 py-3 space-y-2">
                {g.orders.map((o) => (
                  <div key={o.id} className="bg-amber-50 rounded-lg p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm">
                        {o.priority && <span title="Priority">🔴 </span>}
                        {o.description}
                        <span className="block text-xs text-slate-500 font-normal">
                          {o.clientName}
                          {o.buyerName && <> · for {o.buyerName}</>}
                        </span>
                      </p>
                      {o.expectedCompletion && (
                        <span className="text-xs text-amber-800 whitespace-nowrap">
                          due {formatDate(o.expectedCompletion)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {o.poNumber && <>PO {o.poNumber} · </>}
                      {o.finishedWeightKg && <>{o.finishedWeightKg} kg · </>}
                      booked by {o.addedBy.name}
                    </p>
                    {o.notes && <p className="text-xs text-slate-600">{o.notes}</p>}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <Link
                        href={`/jobs/new?from=${o.id}`}
                        className="text-xs font-medium text-blue-700 hover:underline"
                      >
                        Release to production →
                      </Link>
                      {admin && (
                        <form action={deleteFutureJob}>
                          <input type="hidden" name="futureJobId" value={o.id} />
                          <button
                            className="text-xs text-red-600 hover:underline"
                            title="Remove this booking"
                          >
                            ✕
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
