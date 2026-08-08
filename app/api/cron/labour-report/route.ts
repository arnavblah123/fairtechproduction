import { NextRequest, NextResponse } from "next/server";
import { runLabourReport } from "@/lib/labour-report";

// Evening labour-calling report. Normally fired by /api/cron/daily; this
// route stays available so it can be triggered by hand at any time.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runLabourReport();
  return NextResponse.json(result);
}
