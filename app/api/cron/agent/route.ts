import { NextRequest, NextResponse } from "next/server";
import { runMonitor } from "@/lib/ai/monitor";

// The monitoring agent's own endpoint. Vercel Hobby allows only two cron
// entries and both are taken, so this is driven by /api/cron/daily at 11:00
// and 16:00 IST — but it stays callable on its own so the owner can trigger a
// run by hand from the findings panel.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorised =
    !secret || req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorised) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runMonitor();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
