import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Plain-English health check, reachable without logging in — so when the app
// shows "Application error" there is somewhere to look from a phone.
// Reports only schema/connection state, never any business data.
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = { checkedAt: new Date().toISOString() };

  // 1. Can we reach the database at all?
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (e) {
    checks.database = "FAILED";
    checks.databaseError = e instanceof Error ? e.message.slice(0, 400) : String(e);
    return NextResponse.json(
      {
        ok: false,
        problem:
          "The app cannot reach its database. Check the Neon project is awake and within its " +
          "storage limit, and that DATABASE_URL / DIRECT_URL are set on Vercel.",
        ...checks,
      },
      { status: 503 }
    );
  }

  // 2. Have the migrations actually been applied to this database?
  try {
    const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY started_at DESC
      LIMIT 5`;
    checks.lastMigrations = rows.map((r) => ({
      name: r.migration_name,
      applied: r.finished_at !== null,
    }));
    const failed = rows.filter((r) => r.finished_at === null).map((r) => r.migration_name);
    if (failed.length) checks.failedMigrations = failed;
  } catch (e) {
    checks.migrations = "could not read _prisma_migrations";
    checks.migrationsError = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }

  // 3. Do the newest columns/tables exist? A "no" here means the deployed code
  //    is ahead of the database and every page will crash.
  const expected: [string, string][] = [
    ["Job", "poAwaited"],
    ["Job", "finishedWeightKg"],
    ["Issue", "dueAt"],
    ["LeaveDay", "reason"],
    ["Stage", "plannedStart"],
  ];
  const missing: string[] = [];
  for (const [table, column] of expected) {
    try {
      const found = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}`;
      if (Number(found[0]?.n ?? 0) === 0) missing.push(`${table}.${column}`);
    } catch {
      missing.push(`${table}.${column} (check failed)`);
    }
  }
  for (const table of ["LabourComplaint", "LeavePeriod", "StagePlanWorker"]) {
    try {
      const found = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM information_schema.tables WHERE table_name = ${table}`;
      if (Number(found[0]?.n ?? 0) === 0) missing.push(`table ${table}`);
    } catch {
      missing.push(`table ${table} (check failed)`);
    }
  }
  checks.missingSchema = missing;

  // 4. Environment switches the app depends on (names only, never values).
  checks.env = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DIRECT_URL: !!process.env.DIRECT_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    INTEGRATION_EXPORT_KEY: !!process.env.INTEGRATION_EXPORT_KEY,
    whatsapp: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    smtp: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
  };

  const ok = missing.length === 0 && !checks.failedMigrations;
  return NextResponse.json(
    {
      ok,
      problem: ok
        ? null
        : missing.length
          ? "The database is missing columns this version of the app needs — its migrations did not run. Redeploy on Vercel so the build applies them."
          : "A database migration is stuck half-applied. Tell Claude the failed migration name.",
      ...checks,
    },
    { status: ok ? 200 : 503 }
  );
}
