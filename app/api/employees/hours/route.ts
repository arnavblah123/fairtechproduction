import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { monthlyWorkerHours, fmtHours } from "@/lib/worker-hours";

// Date-wise worked hours for one month, as a CSV that opens straight in
// Excel: one row per worker, one column per date, total at the end.
// ?month=YYYY-MM (default: current IST month), ?unit=<unitId> to filter.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Labour-app-only accounts don't get production exports.
  if (user.role === "HR" || user.role === "PURCHASE_HR") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get("month");
  const unitFilter = req.nextUrl.searchParams.get("unit");
  // Scope to the units this login can see; a unit filter narrows further.
  let unitIds: string[] | null = user.role === "SUPERADMIN" ? null : user.unitIds;
  if (unitFilter) {
    if (user.role !== "SUPERADMIN" && !user.unitIds.includes(unitFilter)) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    unitIds = [unitFilter];
  }

  const { workers, daysInMonth, label } = await monthlyWorkerHours(unitIds, month);

  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = [
    "Code",
    "Name",
    "Unit",
    ...Array.from({ length: daysInMonth }, (_, i) => `${label}-${String(i + 1).padStart(2, "0")}`),
    "Total hours",
  ];
  const lines = [header.join(",")];
  for (const w of workers) {
    lines.push(
      [
        esc(w.code),
        esc(w.name),
        esc(w.unit),
        ...w.days.map((min) => (min > 0 ? fmtHours(min) : "")),
        fmtHours(w.totalMinutes),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="worker-hours-${label}.csv"`,
    },
  });
}
