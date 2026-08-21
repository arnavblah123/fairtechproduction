import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/session";
import type { Role } from "@prisma/client";

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

// HR accounts exist only for the Labour app (served at /labour) — bounce
// them there from every production page. Purchase/HR accounts get the Labour
// app plus Issues and Planning, and the accounts desk gets its own pages, so
// all three are bounced from everything else.
export function lockHrToLabour(user: SessionUser) {
  if (user.role === "HR") redirect("/labour");
  if (user.role === "PURCHASE_HR") redirect("/issues");
  if (user.role === "ACCOUNTS") redirect("/accounts");
}

// Pages a Purchase/HR login may open (besides the static Labour app).
export function allowPurchaseHr(user: SessionUser) {
  if (user.role === "HR") redirect("/labour");
  if (user.role === "ACCOUNTS") redirect("/accounts");
}

// Pages the accounts desk may open: its own desk, the order book and the
// New Job form. Everything else on the shop floor stays out of reach.
export function allowAccounts(user: SessionUser) {
  if (user.role === "HR") redirect("/labour");
  if (user.role === "PURCHASE_HR") redirect("/issues");
}

export function isPurchaseHr(user: SessionUser) {
  return user.role === "PURCHASE_HR";
}

// The accounts desk owns a job's paperwork: PO number, PO value, finished
// weight, drawings and BOM — plus booking orders. Never the shop floor.
export function isAccounts(user: SessionUser) {
  return user.role === "ACCOUNTS";
}

export function isAdmin(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "SUPERADMIN";
}

// Company-wide desks are not rostered to units but work for all of them.
export function seesAllUnits(user: SessionUser) {
  return user.role === "SUPERADMIN" || user.role === "ACCOUNTS";
}

export function canAccessUnit(user: SessionUser, unitId: string) {
  // Purchase/HR and HR are company-wide desks (see unitScope below) — they
  // need to act on labour requests from any unit, not just ones they're
  // rostered to.
  if (
    user.role === "SUPERADMIN" ||
    user.role === "PURCHASE_HR" ||
    user.role === "HR" ||
    user.role === "ACCOUNTS"
  ) {
    return true;
  }
  return user.unitIds.includes(unitId);
}

export function assertUnitAccess(user: SessionUser, unitId: string) {
  if (!canAccessUnit(user, unitId)) {
    throw new Error("You do not have access to this unit.");
  }
}

// Prisma `where` fragment limiting a query to the user's units.
// Purchase/HR and HR are company-wide desks — they buy and hire for every unit.
export function unitScope(user: SessionUser): { unitId?: { in: string[] } } {
  if (
    user.role === "SUPERADMIN" ||
    user.role === "PURCHASE_HR" ||
    user.role === "HR" ||
    user.role === "ACCOUNTS"
  ) {
    return {};
  }
  return { unitId: { in: user.unitIds } };
}
