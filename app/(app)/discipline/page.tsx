import { db } from "@/lib/db";
import { requireUser, unitScope, isAdmin } from "@/lib/permissions";
import { deleteDiscipline } from "@/lib/actions/discipline";
import { DISCIPLINE_LABELS } from "@/lib/discipline";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Discipline register: every hour cut, who recorded it, plus this-month
// totals per worker (payroll reference).
export default async function DisciplinePage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const user = await requireUser();
  const { unit: unitFilter } = await searchParams;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [units, entries] = await Promise.all([
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.discipline.findMany({
      where: { ...unitScope(user), ...(unitFilter ? { unitId: unitFilter } : {}) },
      include: {
        employee: { select: { name: true, code: true } },
        unit: { select: { code: true } },
        raisedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  // This-month totals per worker
  const monthTotals = new Map<string, { name: string; code: string; unit: string; hours: number; count: number }>();
  for (const e of entries) {
    if (e.createdAt < monthStart) continue;
    const cur = monthTotals.get(e.employeeId) ?? {
      name: e.employee.name,
      code: e.employee.code,
      unit: e.unit.code,
      hours: 0,
      count: 0,
    };
    cur.hours += e.hoursCut;
    cur.count += 1;
    monthTotals.set(e.employeeId, cur);
  }
  const totals = [...monthTotals.values()].sort((a, b) => b.hours - a.hours);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Discipline Register</h1>
        <form className="flex gap-2 text-sm">
          <select name="unit" defaultValue={unitFilter ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
        </form>
      </div>

      {totals.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-2 text-sm">This month — total hours cut</h2>
          <div className="flex flex-wrap gap-2">
            {totals.map((t) => (
              <span
                key={t.code}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 text-red-900 px-3 py-1.5 text-sm"
              >
                <b>{t.name}</b>
                <span className="text-xs text-red-500">({t.unit})</span>
                <span className="font-semibold">−{t.hours}h</span>
                <span className="text-xs text-red-400">{t.count}×</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Worker</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Hours cut</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Recorded by</th>
              {isAdmin(user) && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap font-medium">
                  {e.employee.name}
                  <span className="text-xs text-slate-400 font-normal"> {e.employee.code}</span>
                </td>
                <td className="px-4 py-2.5">{e.unit.code}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{DISCIPLINE_LABELS[e.reason]}</td>
                <td className="px-4 py-2.5 font-semibold text-red-700">−{e.hoursCut}h</td>
                <td className="px-4 py-2.5 text-slate-600">{e.note ?? ""}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{e.raisedBy.name}</td>
                {isAdmin(user) && (
                  <td className="px-4 py-2.5">
                    <form action={deleteDiscipline}>
                      <input type="hidden" name="disciplineId" value={e.id} />
                      <button className="text-xs text-red-600 hover:underline">Remove</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  No discipline entries. Record them from the Workers page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
