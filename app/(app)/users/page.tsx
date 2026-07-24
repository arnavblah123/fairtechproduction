import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { updateUserRole, setUserActive, setUserUnits, updateUserProfile } from "@/lib/actions/users";
import { UserCreateForm } from "@/components/user-create-form";
import { RoleBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireRole("ADMIN", "SUPERADMIN");
  const units = await db.unit.findMany({
    where: actor.role === "SUPERADMIN" ? {} : { id: { in: actor.unitIds } },
    orderBy: { name: "asc" },
  });
  const users = await db.user.findMany({
    include: { units: { include: { unit: true } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Users</h1>
      <UserCreateForm
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        canCreateAdmins={actor.role === "SUPERADMIN"}
      />

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Units</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const manageable =
                actor.role === "SUPERADMIN"
                  ? u.role !== "SUPERADMIN"
                  : u.role === "SUPERVISOR";
              return (
                <tr key={u.id} className={!u.active ? "opacity-50" : ""}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">{u.name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {u.role === "SUPERADMIN" ? (
                      "All units"
                    ) : manageable ? (
                      <form action={setUserUnits} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        {units.map((unit) => (
                          <label key={unit.id} className="flex items-center gap-1 whitespace-nowrap">
                            <input
                              type="checkbox"
                              name="unitIds"
                              value={unit.id}
                              defaultChecked={u.units.some((x) => x.unit.id === unit.id)}
                              className="h-3.5 w-3.5"
                            />
                            {unit.code}
                          </label>
                        ))}
                        <button className="rounded bg-slate-100 px-2 py-1" title="Save units">
                          ✓
                        </button>
                        {u.units.length === 0 && (
                          <span className="text-red-600 font-semibold">NO UNIT — cannot create jobs!</span>
                        )}
                      </form>
                    ) : (
                      u.units.map((x) => x.unit.name).join(", ") || "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 items-center flex-wrap">
                      {/* Superadmin: everything editable — name, email, password reset */}
                      {actor.role === "SUPERADMIN" && (
                        <details className="w-full">
                          <summary className="cursor-pointer select-none rounded bg-slate-100 px-2 py-1 text-xs inline-block">
                            ✏️ Edit
                          </summary>
                          <form
                            action={updateUserProfile}
                            className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2"
                          >
                            <input type="hidden" name="userId" value={u.id} />
                            <label className="text-xs">
                              <span className="block text-[10px] text-slate-500 mb-0.5">Name</span>
                              <input
                                name="name"
                                defaultValue={u.name}
                                required
                                className="w-36 rounded border border-slate-300 px-2 py-1"
                              />
                            </label>
                            <label className="text-xs">
                              <span className="block text-[10px] text-slate-500 mb-0.5">Email (login)</span>
                              <input
                                name="email"
                                type="email"
                                defaultValue={u.email}
                                required
                                className="w-48 rounded border border-slate-300 px-2 py-1"
                              />
                            </label>
                            <label className="text-xs">
                              <span className="block text-[10px] text-slate-500 mb-0.5">
                                New password (blank = keep current)
                              </span>
                              <input
                                name="password"
                                type="text"
                                minLength={8}
                                placeholder="min 8 characters"
                                className="w-40 rounded border border-slate-300 px-2 py-1"
                              />
                            </label>
                            <button className="rounded bg-slate-900 text-white px-2.5 py-1 text-xs">
                              Save
                            </button>
                          </form>
                        </details>
                      )}
                      {manageable && (
                        <>
                        {actor.role === "SUPERADMIN" && (
                          <form action={updateUserRole} className="flex gap-1">
                            <input type="hidden" name="userId" value={u.id} />
                            <select
                              name="role"
                              defaultValue={u.role}
                              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                            >
                              <option value="ADMIN">Admin</option>
                              <option value="SUPERVISOR">Supervisor</option>
                            </select>
                            <button className="rounded bg-slate-900 text-white px-2 py-1 text-xs">
                              Set role
                            </button>
                          </form>
                        )}
                        <form action={setUserActive}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="active" value={String(!u.active)} />
                          <button className="rounded bg-slate-100 px-2 py-1 text-xs">
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        </form>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
