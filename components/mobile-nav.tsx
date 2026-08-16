"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Thumb-friendly bottom tab bar, phones only (hidden sm+). The remaining
// pages live under /more.
const BASE_TABS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/jobs", label: "Jobs", icon: "🗂️" },
  { href: "/planning", label: "Planning", icon: "🗓️" },
  { href: "/todo", label: "To-Do", icon: "📋" },
  { href: "/order-book", label: "Orders", icon: "📒" },
  { href: "/more", label: "More", icon: "☰" },
];

// `showAssistant` is decided on the server from the role — this component is
// never handed the flag for anyone but the owner, so the tab cannot appear.
export function MobileNav({ showAssistant = false }: { showAssistant?: boolean }) {
  const pathname = usePathname();
  // Ask sits immediately before More, wherever More happens to be — found by
  // name so adding a tab above never silently moves it.
  const moreAt = BASE_TABS.findIndex((t) => t.href === "/more");
  const tabs = showAssistant
    ? [
        ...BASE_TABS.slice(0, moreAt),
        { href: "/assistant", label: "Ask", icon: "🤖" },
        ...BASE_TABS.slice(moreAt),
      ]
    : BASE_TABS;
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
