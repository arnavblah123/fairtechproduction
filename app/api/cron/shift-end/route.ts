import { NextRequest, NextResponse } from "next/server";
import { closeOverdueShifts } from "@/lib/shift";

// Scheduled by Vercel Cron at 22:00 and 02:30 IST (see vercel.json) to stop
// the clocks of workers whose night plan has ended. If CRON_SECRET is set,
// Vercel sends it as a Bearer token and we enforce it.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const closed = await closeOverdueShifts();
  return NextResponse.json({ ok: true, closed });
}
