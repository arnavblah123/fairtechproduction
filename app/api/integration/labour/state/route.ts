import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db as prisma } from "@/lib/db";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session-token";

// Shared worker list for the labour calling app.
//
// GET  ?since=<ISO> — worker records changed since that moment (omit for all).
// POST { changes: [{ id, data }] } — save this device's changes.
//
// Every caller merges this over the app's static seed list, so a follow-up
// booked by one person immediately removes that worker from everyone else's
// calling queue. Last write wins per worker.

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

async function currentUserName(req: NextRequest): Promise<string | null> {
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

export async function GET(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const where = since && !isNaN(since.getTime()) ? { updatedAt: { gt: since } } : {};

  const rows = await prisma.labourWorkerState.findMany({
    where,
    orderBy: { updatedAt: "asc" },
    take: 5000,
  });

  return NextResponse.json(
    {
      serverTime: new Date().toISOString(),
      count: rows.length,
      workers: rows.map((r) => ({
        id: r.seekerId,
        data: r.data,
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: r.updatedBy,
      })),
    },
    { headers: corsHeaders(req) }
  );
}

export async function POST(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  let body: { changes?: Array<{ id?: string; data?: Record<string, unknown> }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(req) });
  }

  const who = await currentUserName(req);
  const changes = (body.changes || []).filter((c) => c && c.id && c.data).slice(0, 1000);

  for (const c of changes) {
    const data = c.data as Prisma.InputJsonObject;
    const phone = typeof c.data!.phone === "string" ? (c.data!.phone as string) : null;
    await prisma.labourWorkerState.upsert({
      where: { seekerId: String(c.id) },
      update: { data, phone, updatedBy: who },
      create: { seekerId: String(c.id), data, phone, updatedBy: who },
    });
  }

  return NextResponse.json(
    { ok: true, saved: changes.length, serverTime: new Date().toISOString() },
    { headers: corsHeaders(req) }
  );
}
