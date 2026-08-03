import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session-token";

// Google Form bridge for the labour calling app.
//
// GET  — fetch the configured Google Sheets CSV (the form's response sheet,
//        published to the web) server-side and return parsed candidates.
//        Fetching here avoids the browser's cross-origin restrictions and
//        means every device shares one configuration.
// POST — save/replace the published CSV link (stored in Setting).

const SETTING_KEY = "labour.formCsvUrl";

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

// Minimal CSV parser: handles quoted fields, embedded commas and newlines.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// Google Forms columns vary; find them by header keyword, and fall back to
// scanning each row for something that looks like a 10-digit Indian mobile.
function pickColumns(header: string[]) {
  const idx = (...keys: string[]) =>
    header.findIndex((h) => keys.some((k) => norm(h).includes(k)));
  return {
    name: idx("name"),
    phone: idx("phone", "mobile", "contact", "number"),
    job: idx("applyfor", "job", "profile", "trade", "post", "work"),
    location: idx("location", "city", "place", "address", "district", "state"),
    timestamp: idx("timestamp", "date"),
  };
}

const digits = (v: string) => (v || "").replace(/\D/g, "");
function asMobile(v: string): string | null {
  let d = digits(v);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export async function GET(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  const csvUrl = row?.value || "";
  if (!csvUrl) {
    return NextResponse.json({ configured: false, csvUrl: "", candidates: [] }, { headers: corsHeaders(req) });
  }

  let text: string;
  try {
    const res = await fetch(csvUrl, { redirect: "follow", cache: "no-store" });
    if (!res.ok) throw new Error(`sheet answered HTTP ${res.status}`);
    text = await res.text();
    if (text.trimStart().startsWith("<")) {
      throw new Error("that link returned a web page, not CSV — publish the sheet as CSV");
    }
  } catch (err) {
    return NextResponse.json(
      { configured: true, csvUrl, error: `Could not read the form sheet: ${String(err instanceof Error ? err.message : err)}`, candidates: [] },
      { status: 502, headers: corsHeaders(req) }
    );
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return NextResponse.json({ configured: true, csvUrl, candidates: [] }, { headers: corsHeaders(req) });
  }
  const header = rows[0];
  const col = pickColumns(header);

  const candidates = rows.slice(1).map((r) => {
    const get = (i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");
    // Prefer the phone column; otherwise take the first cell that looks like
    // a mobile (submitters often swap the name and phone boxes).
    let phone = asMobile(get(col.phone));
    let name = get(col.name);
    if (!phone) {
      for (const cell of r) {
        const m = asMobile(cell);
        if (m) {
          phone = m;
          break;
        }
      }
    }
    // A name box holding the number (or an email) is not a name.
    if (!name || asMobile(name) || name.includes("@")) {
      const alt = r.find((c) => c.trim() && !asMobile(c) && !c.includes("@") && !/^\d/.test(c.trim()) && c.trim().length > 2);
      name = (alt || "").trim();
    }
    return {
      name,
      phone: phone || "",
      job: get(col.job),
      location: get(col.location),
      submittedAt: get(col.timestamp),
    };
  });

  return NextResponse.json(
    { configured: true, csvUrl, total: candidates.length, candidates: candidates.filter((c) => c.phone) },
    { headers: corsHeaders(req) }
  );
}

export async function POST(req: NextRequest) {
  const denied = await unauthorized(req);
  if (denied) return denied;

  let body: { csvUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(req) });
  }
  const csvUrl = String(body.csvUrl || "").trim();
  if (csvUrl && !/^https:\/\/docs\.google\.com\//.test(csvUrl)) {
    return NextResponse.json(
      { error: "Paste the published Google Sheets link (it starts with https://docs.google.com/)" },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: csvUrl },
    create: { key: SETTING_KEY, value: csvUrl },
  });
  return NextResponse.json({ ok: true, csvUrl }, { headers: corsHeaders(req) });
}
