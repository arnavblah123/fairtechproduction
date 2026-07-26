import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { addOverheadItem, stopOverheadItem, deleteOverheadItem } from "@/lib/actions/overheads";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Owner-only register of fixed monthly overheads: rent, electricity,
// maintenance, flat salaries. Every item costs monthlyAmount/30 per day,
// split equally across the jobs running that day — unit items over that
// unit's jobs, company-wide items over all jobs.
export default async function OverheadsPage() {
  await requireRole("SUPERADMIN");
  const [units, items] = await Promise.all([
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.overheadItem.findMany({
      include: { unit: { select: { name: true } } },
      orderBy: [{ endedAt: "asc" }, { createdAt: "desc" }],
    }),
  ]);
  const running = items.filter((i) => !i.endedAt);
  const stopped = items.filter((i) => i.endedAt);
  const monthlyTotal = running.reduce((s, i) => s + i.monthlyAmount, 0);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">💸 Overhead Costs</h1>
        {running.length > 0 && (
          <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm text-sm">
            Running: <b>{formatMoney(monthlyTotal)}</b>/month ={" "}
            <b>{formatMoney(monthlyTotal / 30)}</b>/day
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600">
        Only you can see this page. Each cost is divided by 30 for a daily amount and
        spread equally across the jobs that had work going on that day — so every job
        carries its true share. It shows up inside each job&apos;s cost as Overheads.
      </p>

      {/* Add */}
      <form
        action={addOverheadItem}
        className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-2"
      >
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">Cost name</span>
          <input
            name="name"
            required
            placeholder="Rent / Electricity / Maintenance…"
            className="w-52 rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">₹ per month</span>
          <input
            name="monthlyAmount"
            type="number"
            required
            min={1}
            step="1"
            placeholder="50000"
            className="w-28 rounded-lg border border-slate-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">Applies to</span>
          <select name="unitId" className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">All units (company-wide)</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-slate-500 mb-0.5">Counted from</span>
          <input
            name="effectiveFrom"
            type="date"
            className="rounded-lg border border-slate-300 px-2 py-1.5"
            title="Leave empty for today. Backdate to charge earlier days too."
          />
        </label>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5 text-sm font-medium">
          Add cost
        </button>
      </form>

      {/* Running items */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3">₹/month</th>
              <th className="px-4 py-3">₹/day</th>
              <th className="px-4 py-3">Applies to</th>
              <th className="px-4 py-3">Counted from</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {running.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3 font-medium">{i.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatMoney(i.monthlyAmount)}</td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                  {formatMoney(i.monthlyAmount / 30)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{i.unit?.name ?? "All units"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(i.effectiveFrom)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5">
                    <form action={stopOverheadItem}>
                      <input type="hidden" name="itemId" value={i.id} />
                      <button
                        className="rounded bg-slate-100 px-2 py-1 text-xs"
                        title="Stop from today — days already counted keep their cost"
                      >
                        Stop
                      </button>
                    </form>
                    <form action={deleteOverheadItem}>
                      <input type="hidden" name="itemId" value={i.id} />
                      <button
                        className="rounded bg-red-50 text-red-700 px-2 py-1 text-xs"
                        title="Delete completely — removes its cost from past jobs too"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {running.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No overhead costs yet. Add rent, electricity, maintenance above —
                  they&apos;ll be spread across every running job automatically.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Stopped items */}
      {stopped.length > 0 && (
        <details className="bg-white rounded-xl shadow-sm p-4">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-600">
            Stopped costs ({stopped.length}) — still counted for their past days
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-500">
            {stopped.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">{i.name}</span>
                <span>{formatMoney(i.monthlyAmount)}/mo</span>
                <span>· {i.unit?.name ?? "All units"}</span>
                <span>
                  · {formatDate(i.effectiveFrom)} – {formatDate(i.endedAt!)}
                </span>
                <form action={deleteOverheadItem}>
                  <input type="hidden" name="itemId" value={i.id} />
                  <button className="text-xs text-red-600 hover:underline">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-xs text-slate-500">
        Tip: when a bill changes (say rent goes up), Stop the old item and Add a new
        one — history keeps the old rate for old days. If you enter supervisor
        salaries here as a fixed cost, leave their salary blank on the Users page so
        it isn&apos;t counted twice.
      </p>
    </div>
  );
}
