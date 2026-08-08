import { NextRequest, NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/monitor";

// Scheduled twice a day — 11:00 and 16:00 IST — to run the production
// monitoring agent.
//
// The evening labour-calling report used to run from here too. It is switched
// off for now (no reports were arriving); /api/cron/labour-report is still in
// the codebase and can be called by hand, and re-scheduling it is one line in
// vercel.json plus a branch here.
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
  const result = await runMonitor();
  return NextResponse.json({ ran: "monitor", istHour, ...result }, {
    status: result.ok ? 200 : 500,
  });
}
