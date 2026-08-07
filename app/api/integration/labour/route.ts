import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session-token";

// Integration endpoint for the Fairtech Labour app (recruitment/calling
// system on GitHub Pages). Browser-called, so it needs CORS.
//
// GET  — employee register with current unit + who punched in today.
// POST — create an employee (a hired labourer moving into production).
//
// Auth: same INTEGRATION_EXPORT_KEY used by the consumables app, sent as
// x-integration-key. The labour app stores the key on the operator's phone,
// not in its public source.

const ALLOWED_ORIGINS = new Set([
  "https://arnavblah123.github.io",
  "http://localhost:4173",
  "http://localhost:5173",
]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://arnavblah123.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-integration-key",
    "Access-Control-Max-Age": "86400",
  };
}

async function unauthorized(req: NextRequest) {
  // Two ways in: a logged-in production user's session cookie (the labour
  // app served from /labour uses this — no key needed), or the shared
  // integration key for external callers (e.g. the GitHub Pages copy).
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token && (await verifySessionToken(token))) return null;

  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (key && req.headers.get("x-integration-key") === key) return null;

  return NextResponse.json(
    { error: "Unauthorized — log in to the production app or send a valid integration key" },
    { status: 401, headers: corsHeaders(req) }
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  const [units, employees] = await Promise.all([
    prisma.unit.findMany({ select: { code: true, name: true, location: true } }),
    prisma.employee.findMany({
      include: {
        primaryUnit: { select: { code: true, name: true } },
        transfers: {
          where: { toDate: null },
          include: { toUnit: { select: { code: true, name: true } } },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // "Present today" = punched LOGIN today (IST) or has a time log touching
  // today — started today, still open, or a night shift that ran into today.
  const IST_MS = 5.5 * 3600 * 1000;
  const istNow = new Date(Date.now() + IST_MS);
  const istMidnightUtc = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - IST_MS
  );
  const [logins, logs] = await Promise.all([
    prisma.attendanceEvent.findMany({
      where: { eventType: "LOGIN", occurredAt: { gte: istMidnightUtc } },
      select: { employeeCode: true },
    }),
    prisma.timeLog.findMany({
      where: {
        OR: [
          { startedAt: { gte: istMidnightUtc } },
          { endedAt: null },
          { endedAt: { gte: istMidnightUtc } },
        ],
      },
      select: { employee: { select: { code: true } } },
    }),
  ]);
  const presentToday = new Set<string>();
  for (const l of logins) presentToday.add(l.employeeCode);
  for (const l of logs) presentToday.add(l.employee.code);

  // Long holidays: who is away, and until when. The calling app needs this so
  // a man on leave in his village isn't rung or counted absent.
  const istToday = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate())
  );
  const leavePeriods = await prisma.leavePeriod.findMany({
    where: { toDate: { gte: istToday } },
    include: { employee: { select: { code: true, name: true } } },
    orderBy: { fromDate: "asc" },
  });
  const onLeave = leavePeriods.map((l) => ({
    code: l.employee.code,
    name: l.employee.name,
    from: l.fromDate.toISOString().slice(0, 10),
    to: l.toDate.toISOString().slice(0, 10),
    reason: l.reason,
    awayNow: l.fromDate <= istToday && l.toDate >= istToday,
  }));
  const awayTodayCodes = new Set(onLeave.filter((l) => l.awayNow).map((l) => l.code));

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      units,
      employees: employees.map((e) => {
        const current = e.transfers[0]?.toUnit ?? e.primaryUnit;
        return {
          code: e.code,
          name: e.name,
          skill: e.skill,
          contact: e.contact,
          active: e.active,
          unitCode: current.code,
          unitName: current.name,
          joinedAt: e.createdAt.toISOString().slice(0, 10),
          onLeaveToday: awayTodayCodes.has(e.code),
        };
      }),
      presentToday: [...presentToday],
      onLeave,
    },
    { headers: corsHeaders(req) }
  );
}

export async function POST(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  let body: { name?: string; skill?: string; contact?: string; unitCode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(req) });
  }
  const name = String(body.name || "").trim();
  const skill = String(body.skill || "").trim() || "helper";
  const contact = String(body.contact || "").trim() || null;
  const unitCode = String(body.unitCode || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400, headers: corsHeaders(req) });
  }
  const unit = unitCode
    ? await prisma.unit.findUnique({ where: { code: unitCode } })
    : await prisma.unit.findFirst({ orderBy: { code: "asc" } });
  if (!unit) {
    return NextResponse.json({ error: `Unknown unit code "${unitCode}"` }, { status: 400, headers: corsHeaders(req) });
  }

  // A worker re-hired with the same phone number comes back as the existing
  // record instead of a duplicate.
  if (contact) {
    const existing = await prisma.employee.findFirst({ where: { contact } });
    if (existing) {
      if (!existing.active) {
        await prisma.employee.update({ where: { id: existing.id }, data: { active: true } });
      }
      return NextResponse.json(
        { ok: true, alreadyExists: true, code: existing.code, name: existing.name },
        { headers: corsHeaders(req) }
      );
    }
  }

  // Same auto-code convention as the in-app quick add.
  const count = await prisma.employee.count();
  let code = `EMP${String(count + 1).padStart(3, "0")}`;
  while (await prisma.employee.findUnique({ where: { code } })) {
    code = `EMP${String(Number(code.slice(3)) + 1).padStart(3, "0")}`;
  }

  const employee = await prisma.employee.create({
    data: {
      name,
      code,
      skill: skill.toLowerCase(),
      contact,
      primaryUnitId: unit.id,
      transfers: { create: { toUnitId: unit.id } },
    },
  });

  return NextResponse.json(
    { ok: true, alreadyExists: false, code: employee.code, name: employee.name },
    { headers: corsHeaders(req) }
  );
}
