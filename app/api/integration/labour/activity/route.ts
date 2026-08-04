import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db as prisma } from "@/lib/db";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session-token";

// Receives calling-activity batches from the labour app: each phone keeps
// an outbox of interactions (calls, WhatsApps, outcomes) and posts them
// here together with its current pipeline counts. Powers the daily report.

const ALLOWED_ORIGINS = new Set([
  "https://arnavblah123.github.io",
  "http://localhost:4173",
  "http://localhost:5173",
]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://arnavblah123.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-integration-key",
    "Access-Control-Max-Age": "86400",
  };
}

async function unauthorized(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token && (await verifySessionToken(token))) return null;
  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (key && req.headers.get("x-integration-key") === key) return null;
  return NextResponse.json(
    { error: "Unauthorized — log in to the production app or send a valid integration key" },
    { status: 401, headers: corsHeaders(req) }
  );
}

// Name of the logged-in user pushing this batch, so reports can show who
// did the calling. Null for key-authenticated callers.
async function actorName(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { name: true },
  });
  return user?.name ?? null;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

const CALL_ACTIONS = new Set(["call_started", "call_saved_contact", "call_followup", "call_retry"]);
const OUTCOME_ACTIONS = new Set([
  "not_interested",
  "call_later",
  "no_response",
  "saved_contact",
  "hired",
  "interested",
]);

// Team report: per-person and per-day totals across everyone's devices, so
// the app can show who is doing what without each phone knowing the others.
export async function GET(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days") || 14), 1), 60);
  const IST_MS = 5.5 * 3600 * 1000;
  const istNow = new Date(Date.now() + IST_MS);
  const todayKey = istNow.toISOString().slice(0, 10);
  const from = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - (days - 1)) - IST_MS
  );

  const rows = await prisma.labourActivity.findMany({
    where: { occurredAt: { gte: from } },
    orderBy: { occurredAt: "asc" },
    select: { actorName: true, action: true, occurredAt: true, subjectId: true },
  });

  type Bucket = { calls: number; entered: number; msgs: number; workers: Set<string> };
  const mk = (): Bucket => ({ calls: 0, entered: 0, msgs: 0, workers: new Set() });
  const byPerson: Record<string, Bucket> = {};
  const byPersonToday: Record<string, Bucket> = {};
  const byDay: Record<string, Bucket> = {};

  for (const r of rows) {
    const dayKey = new Date(r.occurredAt.getTime() + IST_MS).toISOString().slice(0, 10);
    const who = r.actorName || "Unknown device";
    for (const [map, key] of [
      [byPerson, who],
      [byDay, dayKey],
      ...(dayKey === todayKey ? ([[byPersonToday, who]] as const) : []),
    ] as Array<[Record<string, Bucket>, string]>) {
      const b = (map[key] = map[key] || mk());
      if (CALL_ACTIONS.has(r.action)) {
        b.calls++;
        b.workers.add(r.subjectId);
      }
      if (OUTCOME_ACTIONS.has(r.action)) b.entered++;
      if (r.action === "whatsapp_sent") b.msgs++;
    }
  }

  const flat = (m: Record<string, Bucket>) =>
    Object.fromEntries(
      Object.entries(m).map(([k, b]) => [k, { calls: b.calls, entered: b.entered, msgs: b.msgs, workers: b.workers.size }])
    );

  return NextResponse.json(
    { today: todayKey, days, byPerson: flat(byPerson), byPersonToday: flat(byPersonToday), byDay: flat(byDay) },
    { headers: corsHeaders(req) }
  );
}

type IncomingActivity = {
  id?: string;
  subjectId?: string;
  subjectName?: string;
  action?: string;
  notes?: string;
  timestamp?: string;
};

export async function POST(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  let body: { activities?: IncomingActivity[]; snapshot?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(req) });
  }

  const actor = await actorName(req);
  const rows = (body.activities || [])
    .filter((a) => a && a.id && a.action)
    .slice(0, 500)
    .map((a) => ({
      clientId: String(a.id),
      subjectId: String(a.subjectId || ""),
      subjectName: String(a.subjectName || ""),
      actorName: actor,
      action: String(a.action),
      notes: a.notes ? String(a.notes) : null,
      occurredAt: a.timestamp ? new Date(a.timestamp) : new Date(),
    }))
    .filter((a) => !isNaN(a.occurredAt.getTime()));

  let inserted = 0;
  if (rows.length) {
    const res = await prisma.labourActivity.createMany({ data: rows, skipDuplicates: true });
    inserted = res.count;
  }

  if (body.snapshot && typeof body.snapshot === "object") {
    const data = body.snapshot as Prisma.InputJsonObject;
    await prisma.labourSnapshot.upsert({
      where: { id: "latest" },
      update: { data },
      create: { id: "latest", data },
    });
  }

  return NextResponse.json({ ok: true, inserted }, { headers: corsHeaders(req) });
}
