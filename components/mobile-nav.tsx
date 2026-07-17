"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Thumb-friendly bottom tab bar, phones only (hidden sm+). The remaining
// pages live under /more.
const tabs = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/jobs", label: "Jobs", icon: "🗂️" },
  { href: "/employees", label: "Workers", icon: "👷" },
  { href: "/issues", label: "Issues", icon: "🚩" },
  { href: "/more", label: "More", icon: "☰" },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-slate-900 text-slate-300 border-t border-slate-700 pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {tabs.map((t) => {
          const active =
            t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] leading-none ${
                  active ? "text-white font-semibold" : ""
                }`}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
