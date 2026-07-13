import { NextRequest, NextResponse } from "next/server";
import { getAdapter } from "@/lib/attendance/adapters";
import { processAttendanceEvent } from "@/lib/attendance/processor";

// Attendance webhook endpoint. The vendor's biometric system POSTs
// login/logout events here. Until the real vendor format is known, the
// "generic" adapter accepts:
//   { "employeeCode": "EMP001", "eventType": "LOGIN" | "LOGOUT",
//     "occurredAt": "2026-07-13T08:00:00Z" (optional) }
// or { "events": [ ...same shape... ] }
//
// Select a vendor adapter with ?adapter=<name> once one is implemented in
// lib/attendance/adapters.ts.
export async function POST(req: NextRequest) {
  const secret = process.env.ATTENDANCE_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const adapter = getAdapter(req.nextUrl.searchParams.get("adapter"));
  let events;
  try {
    events = adapter.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Payload not understood by adapter "${adapter.name}"`, detail: String(err) },
      { status: 422 }
    );
  }

  const results = [];
  for (const event of events) {
    const result = await processAttendanceEvent(event);
    results.push({ employeeCode: event.employeeCode, eventType: event.eventType, result });
  }
  return NextResponse.json({ ok: true, processed: results });
}
