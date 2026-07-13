import Link from "next/link";
import { requireUser } from "@/lib/permissions";
import { logout } from "@/lib/actions/auth";
import { RoleBadge } from "@/components/badges";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/jobs", label: "Jobs" },
    ...(isAdmin ? [{ href: "/templates", label: "Templates" }] : []),
    { href: "/employees", label: "Employees" },
    { href: "/issues", label: "Issues" },
    { href: "/attendance", label: "Attendance" },
    ...(isAdmin ? [{ href: "/users", label: "Users" }] : []),
    ...(user.role === "SUPERADMIN" ? [{ href: "/audit", label: "Audit" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
          <Link href="/" className="font-bold whitespace-nowrap">
            Fairtech
          </Link>
          <nav className="flex-1 overflow-x-auto">
            <ul className="flex gap-1 text-sm">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="block px-3 py-2 rounded-lg hover:bg-slate-700 whitespace-nowrap"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden sm:inline text-slate-300">{user.name}</span>
            <RoleBadge role={user.role} />
            <form action={logout}>
              <button className="px-2 py-1 rounded hover:bg-slate-700 text-slate-300">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4">{children}</main>
    </div>
  );
}
