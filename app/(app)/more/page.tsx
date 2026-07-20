import Link from "next/link";
import { requireUser } from "@/lib/permissions";
import { logout } from "@/lib/actions/auth";
import { RoleBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

// Mobile "More" menu: everything that isn't on the bottom tab bar.
export default async function MorePage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";

  const links = [
    { href: "/history", label: "Completed Job History", icon: "📊" },
    { href: "/discipline", label: "Discipline Register", icon: "⚠️" },
    ...(isAdmin ? [{ href: "/templates", label: "Process Templates", icon: "📋" }] : []),
    ...(isAdmin ? [{ href: "/users", label: "Users", icon: "👤" }] : []),
    { href: "/attendance", label: "Attendance Events", icon: "🕐" },
    ...(user.role === "SUPERADMIN" ? [{ href: "/planner", label: "Owner's Planner", icon: "📅" }] : []),
    ...(user.role === "SUPERADMIN" ? [{ href: "/audit", label: "Audit Trail", icon: "🔍" }] : []),
    { href: "/account", label: "My Account & Password", icon: "⚙️" },
  ];

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
        <div>
          <p className="font-semibold">{user.name}</p>
          <p className="text-sm text-slate-500">{user.email}</p>
        </div>
        <RoleBadge role={user.role} />
      </div>
      <div className="bg-white rounded-xl shadow-sm divide-y divide-slate-100">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-100"
          >
            <span className="text-xl">{l.icon}</span>
            <span className="font-medium">{l.label}</span>
            <span className="ml-auto text-slate-300">›</span>
          </Link>
        ))}
      </div>
      <form action={logout}>
        <button className="w-full rounded-xl bg-white shadow-sm px-4 py-3.5 text-left font-medium text-red-600 hover:bg-red-50">
          Log out
        </button>
      </form>
    </div>
  );
}
