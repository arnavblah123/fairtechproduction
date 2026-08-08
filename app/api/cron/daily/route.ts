import { NextRequest, NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/monitor";

// One cron entry, several jobs — Vercel's Hobby plan allows only two cron
// schedules, so this single endpoint fires at 11:00, 16:00 and 20:00 IST and
// dispatches by the hour it woke up in:
//
//   11:00 IST → monitoring agent run
//   16:00 IST → monitoring agent run
//   20:00 IST → daily labour-calling report (the old /api/cron/labour-report)
//
// `?task=` forces one of them, for testing.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const istHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false })
  );
  const forced = req.nextUrl.searchParams.get("task");
  const task = forced ?? (istHour >= 19 ? "labour-report" : "monitor");

  if (task === "labour-report") {
    // Reuse the existing route so its logic stays in one place.
    const { GET: labourReport } = await import("@/app/api/cron/labour-report/route");
    const result = await labourReport(req);
    return NextResponse.json({ ran: "labour-report", istHour, status: result.status });
  }

  const result = await runMonitor();
  return NextResponse.json({ ran: "monitor", istHour, ...result }, {
    status: result.ok ? 200 : 500,
  });
}
