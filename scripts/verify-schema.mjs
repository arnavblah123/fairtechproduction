// Build guard: make sure the database the APP reads (DATABASE_URL) really has
// the schema this code needs.
//
// Prisma runs migrations against DIRECT_URL. If DIRECT_URL and DATABASE_URL
// point at different Neon branches/databases, `migrate deploy` reports success
// while the app keeps reading an old schema — and every page 500s with
// "Application error". That happened once; it must never happen silently again.
//
// If anything is missing we re-run the migrations against DATABASE_URL itself
// (idempotent), then re-check and fail the build loudly if it is still wrong.

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Newest things each release needs. Add to this when a migration adds
// something a page reads on load.
const COLUMNS = [
  ["Job", "poAwaited"],
  ["Job", "poExpectedBy"],
  ["Job", "finishedWeightKg"],
  ["Job", "drawingPending"],
  ["JobAttachment", "sourceJobId"],
  ["FutureJob", "expectedCompletion"], // order book, read by the Order Book page
  ["JobAttachment", "futureJobId"], // drawings booked against an order
  ["Issue", "dueAt"],
  ["LeaveDay", "reason"],
  ["Stage", "plannedStart"],
];
const TABLES = ["LabourComplaint", "LeavePeriod", "StagePlanWorker", "ai_tool_calls", "daily_findings", "GeneralIssue"];

async function missingBits(db) {
  const missing = [];
  for (const [table, column] of COLUMNS) {
    const rows = await db.$queryRaw`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}`;
    if ((rows[0]?.n ?? 0) === 0) missing.push(`${table}.${column}`);
  }
  for (const table of TABLES) {
    const rows = await db.$queryRaw`
      SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = ${table}`;
    if ((rows[0]?.n ?? 0) === 0) missing.push(`table ${table}`);
  }
  return missing;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("verify-schema: DATABASE_URL is not set — cannot check the app's database.");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });
try {
  let missing = await missingBits(db);
  if (missing.length === 0) {
    console.log("verify-schema: the app's database has everything this build needs ✓");
  } else {
    console.warn(
      `verify-schema: the app's database is missing ${missing.length} item(s): ${missing.join(", ")}`
    );
    console.warn(
      "verify-schema: DIRECT_URL and DATABASE_URL may point at different databases — " +
        "re-running migrations against DATABASE_URL itself."
    );
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: { ...process.env, DIRECT_URL: url },
    });
    missing = await missingBits(db);
    if (missing.length > 0) {
      console.error(
        "verify-schema: STILL missing after re-running migrations: " + missing.join(", ")
      );
      console.error(
        "verify-schema: failing the build on purpose — deploying now would show " +
          '"Application error" on every screen. Check that DATABASE_URL and DIRECT_URL ' +
          "on Vercel point at the same Neon database."
      );
      process.exit(1);
    }
    console.log("verify-schema: fixed — the app's database is up to date ✓");
  }
} catch (e) {
  console.error("verify-schema: could not check the database:", e?.message ?? e);
  process.exit(1);
} finally {
  await db.$disconnect();
}
