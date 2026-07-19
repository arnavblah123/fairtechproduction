import { db } from "@/lib/db";
import { requireUser, isAdmin } from "@/lib/permissions";
import { transferEmployee, setEmployeeActive, setBiometricId } from "@/lib/actions/employees";
import { QuickAddEmployee } from "@/components/quick-add-employee";
import { DisciplineForm } from "@/components/discipline-form";
import { LiveDuration } from "@/components/live-duration";
import { formatDate, jobCode, ACTIVITY_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; q?: string; inactive?: string }>;
}) {
  const user = await requireUser();
  const { unit: unitFilter, q, inactive } = await searchParams;

  const units = await db.unit.findMany({
    where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
    orderBy: { name: "asc" },
  });
  const unitIds = units.map((u) => u.id);

  const employees = await db.employee.findMany({
    where: {
      primaryUnitId: unitFilter ? unitFilter : { in: unitIds },
      ...(inactive === "1" ? {} : { active: true }),
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
    include: {
      primaryUnit: true,
      transfers: {
        orderBy: { fromDate: "desc" },
        include: { fromUnit: true, toUnit: true },
      },
      timeLogs: {
        where: { endedAt: null },
        include: { stage: true, job: true },
      },
      disciplines: {
        where: {
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        select: { hoursCut: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Employees</h1>

      {/* 30-second quick add */}
      <QuickAddEmployee units={units.map((u) => ({ id: u.id, name: u.name }))} />

      <form className="flex flex-wrap gap-2 bg-white rounded-xl shadow-sm p-3 text-sm items-center">
        <select name="unit" defaultValue={unitFilter ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">All units</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search name / code / skill…"
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="inactive" value="1" defaultChecked={inactive === "1"} className="h-4 w-4" />
          Show inactive
        </label>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
      </form>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Bio #</th>
              <th className="px-4 py-3">Skill</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3">Working on now</th>
              <th className="px-4 py-3">Discipline</th>
              <th className="px-4 py-3">Transfer history</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((emp) => (
              <tr key={emp.id} className={!emp.active ? "opacity-50" : ""}>
                <td className="px-4 py-3 font-medium whitespace-nowrap">
                  {emp.name}
                  {emp.contact && (
                    <p className="text-xs text-slate-400 font-normal">{emp.contact}</p>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{emp.code}</td>
                <td className="px-4 py-3">
                  <form action={setBiometricId} className="flex gap-1">
                    <input type="hidden" name="employeeId" value={emp.id} />
                    <input
                      name="biometricId"
                      defaultValue={emp.biometricId ?? ""}
                      placeholder="—"
                      className="w-14 rounded border border-slate-200 px-1.5 py-1 text-xs"
                      title="Enrollment number in the biometric machine"
                    />
                    <button className="rounded bg-slate-100 px-1.5 py-1 text-xs" title="Save Bio #">
                      ✓
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3">{emp.skill}</td>
                <td className="px-4 py-3 whitespace-nowrap">{emp.primaryUnit.name}</td>
                <td className="px-4 py-3">
                  {emp.timeLogs.length > 0 ? (
                    emp.timeLogs.map((log) => (
                      <p key={log.id} className="text-blue-800 whitespace-nowrap">
                        {log.stage && log.job ? (
                          <>
                            {log.stage.name}
                            <span className="text-slate-400">
                              {" "}· {jobCode(log.job.jobNumber)} ({log.job.clientName}) ·{" "}
                              <LiveDuration since={log.startedAt} />
                            </span>
                          </>
                        ) : (
                          <>
                            {ACTIVITY_LABELS[log.activity] ?? log.activity}
                            <span className="text-slate-400">
                              {" "}· <LiveDuration since={log.startedAt} />
                            </span>
                          </>
                        )}
                      </p>
                    ))
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {emp.disciplines.length > 0 && (
                    <p className="text-xs text-red-700 font-medium mb-1 whitespace-nowrap">
                      {emp.disciplines.reduce((s, d) => s + d.hoursCut, 0)}h cut this month
                    </p>
                  )}
                  <DisciplineForm employeeId={emp.id} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {emp.transfers.slice(0, 3).map((t) => (
                    <p key={t.id} className="whitespace-nowrap">
                      {t.fromUnit ? `${t.fromUnit.code} → ` : ""}
                      {t.toUnit.code} · {formatDate(t.fromDate)}
                      {t.toDate ? `–${formatDate(t.toDate)}` : " (current)"}
                    </p>
                  ))}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 items-center">
                    <form action={transferEmployee} className="flex gap-1">
                      <input type="hidden" name="employeeId" value={emp.id} />
                      <select
                        name="toUnitId"
                        defaultValue=""
                        required
                        className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                      >
                        <option value="" disabled>Transfer to…</option>
                        {units
                          .filter((u) => u.id !== emp.primaryUnitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>{u.code}</option>
                          ))}
                      </select>
                      <button className="rounded bg-slate-900 text-white px-2 py-1 text-xs">Go</button>
                    </form>
                    {isAdmin(user) && (
                      <form action={setEmployeeActive}>
                        <input type="hidden" name="employeeId" value={emp.id} />
                        <input type="hidden" name="active" value={String(!emp.active)} />
                        <button className="rounded bg-slate-100 px-2 py-1 text-xs">
                          {emp.active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No employees found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
