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

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
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

  const rows = (body.activities || [])
    .filter((a) => a && a.id && a.action)
    .slice(0, 500)
    .map((a) => ({
      clientId: String(a.id),
      subjectId: String(a.subjectId || ""),
      subjectName: String(a.subjectName || ""),
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
