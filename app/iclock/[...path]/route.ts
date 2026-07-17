import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { processAttendanceEvent } from "@/lib/attendance/processor";

// ---------------------------------------------------------------------------
// ZKTeco ADMS ("iclock") push receiver.
//
// The biometric device is configured with this app as its Cloud Server and
// pushes every punch in real time:
//   GET  /iclock/cdata?SN=...&options=all   → handshake, server sends options
//   POST /iclock/cdata?SN=...&table=ATTLOG  → punch lines (PIN\tTIME\tSTATUS…)
//   GET  /iclock/getrequest?SN=...          → device polls for commands
//   POST /iclock/devicecmd, fdata, edata…   → acknowledged, not used
//
// Punch STATUS mapping: 0/3/4 (check-in, break-in, OT-in) → LOGIN;
// 1/2/5 (check-out, break-out, OT-out) → LOGOUT. Device timestamps are IST.
//
// Optionally restrict to known devices with ATTENDANCE_ALLOWED_SN (comma-
// separated serial numbers). Unknown devices get "OK" (so they don't retry
// forever) but nothing is processed.
// ---------------------------------------------------------------------------

const IN_STATUSES = new Set(["0", "3", "4"]);
const OUT_STATUSES = new Set(["1", "2", "5"]);

function text(body: string) {
  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain" },
  });
}

function snAllowed(sn: string | null): boolean {
  const allowed = (process.env.ATTENDANCE_ALLOWED_SN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return sn !== null && allowed.includes(sn);
}

// Device clocks are set to IST; convert "YYYY-MM-DD HH:mm:ss" to a real Date.
function parseDeviceTime(s: string): Date | null {
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const endpoint = path.join("/");
  const sn = req.nextUrl.searchParams.get("SN");

  if (endpoint === "cdata") {
    // Handshake: tell the device to push attendance logs in real time.
    if (!snAllowed(sn)) return text("OK");
    return text(
      [
        `GET OPTION FROM: ${sn ?? ""}`,
        "ATTLOGStamp=None",
        "OPERLOGStamp=None",
        "ATTPHOTOStamp=None",
        "ErrorDelay=30",
        "Delay=10",
        "TransTimes=00:00;12:00",
        "TransInterval=1",
        "TransFlag=TransData AttLog",
        "Realtime=1",
        "Encrypt=None",
      ].join("\n") + "\n"
    );
  }

  // getrequest (command poll) and anything else: nothing to do.
  return text("OK");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const endpoint = path.join("/");
  const sp = req.nextUrl.searchParams;
  const sn = sp.get("SN");
  const table = sp.get("table");

  if (endpoint !== "cdata" || table !== "ATTLOG" || !snAllowed(sn)) {
    return text("OK");
  }

  const body = await req.text();
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  let processed = 0;

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const pin = parts[0].trim();
    const occurredAt = parseDeviceTime(parts[1].trim());
    const status = (parts[2] ?? "0").trim();
    if (!pin || !occurredAt) continue;

    const eventType = OUT_STATUSES.has(status)
      ? "LOGOUT"
      : IN_STATUSES.has(status)
      ? "LOGIN"
      : "LOGIN"; // unknown punch state — treat as check-in, raw kept for review

    // Resolve the machine PIN to an employee: Bio # first, then code.
    const employee = await db.employee.findFirst({
      where: { OR: [{ biometricId: pin }, { code: pin }] },
    });
    const employeeCode = employee?.code ?? `PIN:${pin}`;

    // Devices resend batches when a response is lost — skip exact duplicates.
    const dupe = await db.attendanceEvent.findFirst({
      where: { employeeCode, eventType, occurredAt },
    });
    if (dupe) continue;

    await processAttendanceEvent({
      employeeCode,
      eventType,
      occurredAt,
      raw: { source: "zkteco-adms", sn, line },
    });
    processed++;
  }

  return text(`OK: ${processed}`);
}
