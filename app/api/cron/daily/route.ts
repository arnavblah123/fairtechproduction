import { NextRequest, NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/monitor";
import { runLabourReport } from "@/lib/labour-report";

// Scheduled three times a day — 11:00, 16:00 and 20:00 IST. The morning and
// afternoon runs work the production monitoring agent; the evening run sends
// the labour-calling report (calls made, results entered, who did what, and
// the pipeline by stage). The response says whether the mail actually left,
// and why not when it didn't, so a silent failure shows up in the Vercel cron
// log instead of simply producing no email.
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
  // Evening slot (or an explicit ?task=labour) sends the labour report.
  if (istHour >= 18 || req.nextUrl.searchParams.get("task") === "labour") {
    const result = await runLabourReport();
    return NextResponse.json({ ran: "labour-report", istHour, ...result });
  }

  const result = await runMonitor();
  return NextResponse.json({ ran: "monitor", istHour, ...result }, {
    status: result.ok ? 200 : 500,
  });
}
