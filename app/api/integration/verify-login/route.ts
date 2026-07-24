import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db as prisma } from "@/lib/db";

// Lets the inventory app verify a login against production's users, so both
// apps share one set of credentials (a password change here works there on
// the next login). Guarded by the same INTEGRATION_EXPORT_KEY.
export async function POST(req: NextRequest) {
  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (!key) {
    return NextResponse.json({ error: "INTEGRATION_EXPORT_KEY not configured" }, { status: 503 });
  }
  if (req.headers.get("x-integration-key") !== key) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");
  if (!email || !password) return NextResponse.json({ ok: false });

  const user = await prisma.user.findUnique({
    where: { email },
    include: { units: { include: { unit: { select: { code: true } } } } },
  });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({
    ok: true,
    name: user.name,
    role: user.role,
    active: user.active,
    // SUPERADMIN sees all units; others are scoped to their assigned units
    units: user.role === "SUPERADMIN" ? null : user.units.map((u) => u.unit.code),
  });
}
