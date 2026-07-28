import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { setEmployeeWage, setEmployeeEsiPf } from "@/lib/actions/employees";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// Labour rates register — owner and HR only. Hourly wages and monthly
// ESI/PF per worker; these drive job labour costs and overheads. HR
// accounts can access only this page.
export default async function LabourPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; q?: string }>;
}) {
  await requireRole("SUPERADMIN", "HR");
  const { unit: unitFilter, q } = await searchParams;

  const [units, employees] = await Promise.all([
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: {
        active: true,
        ...(unitFilter ? { primaryUnitId: unitFilter } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
                { skill: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { primaryUnit: { select: { name: true, code: true } } },
      orderBy: [{ primaryUnitId: "asc" }, { name: "asc" }],
    }),
  ]);
  const withWage = employees.filter((e) => e.hourlyWage !== null).length;
  const esiPfTotal = employees.reduce((s, e) => s + (e.esiPfMonthly ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">💼 Labour — Wages &amp; ESI/PF</h1>
        <div className="flex gap-2 text-sm">
          <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
            <b>{withWage}</b>/{employees.length} wages set
          </span>
          {esiPfTotal > 0 && (
            <span className="bg-white rounded-lg px-3 py-1.5 shadow-sm">
              ESI/PF <b>{formatMoney(esiPfTotal)}</b>/mo total
            </span>
          )}
        </div>
      </div>
      <p className="text-sm text-slate-600">
        Hourly wage × logged hours becomes each job&apos;s labour cost. ESI/PF is a
        monthly lump sum, spread over the jobs the worker was on. Supervisors never
        see these numbers.
      </p>

      <form className="flex flex-wrap gap-2 bg-white rounded-xl shadow-sm p-3 text-sm items-center">
        <select
          name="unit"
          defaultValue={unitFilter ?? ""}
          className="rounded-lg border border-slate-300 px-2 py-1.5"
        >
          <option value="">All units</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name / code / skill…"
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Skill</th>
              <th className="px-4 py-3">Wage ₹/hr</th>
              <th className="px-4 py-3">ESI/PF ₹/mo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td className="px-4 py-3 font-medium whitespace-nowrap">{emp.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">{emp.code}</td>
                <td className="px-4 py-3 whitespace-nowrap">{emp.primaryUnit.code}</td>
                <td className="px-4 py-3">{emp.skill}</td>
                <td className="px-4 py-3">
                  <form action={setEmployeeWage} className="flex gap-1">
                    <input type="hidden" name="employeeId" value={emp.id} />
                    <input
                      name="hourlyWage"
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={emp.hourlyWage ?? ""}
                      placeholder="—"
                      className="w-20 rounded border border-slate-200 px-1.5 py-1 text-xs"
                    />
                    <button className="rounded bg-slate-100 px-1.5 py-1 text-xs" title="Save wage">
                      ✓
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3">
                  <form action={setEmployeeEsiPf} className="flex gap-1">
                    <input type="hidden" name="employeeId" value={emp.id} />
                    <input
                      name="esiPfMonthly"
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={emp.esiPfMonthly ?? ""}
                      placeholder="—"
                      className="w-20 rounded border border-slate-200 px-1.5 py-1 text-xs"
                    />
                    <button className="rounded bg-slate-100 px-1.5 py-1 text-xs" title="Save ESI/PF">
                      ✓
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No workers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
