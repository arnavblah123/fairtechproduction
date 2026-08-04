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
// app plus Issues and Planning, so they are bounced from everything else.
export function lockHrToLabour(user: SessionUser) {
  if (user.role === "HR") redirect("/labour");
  if (user.role === "PURCHASE_HR") redirect("/issues");
}

// Pages a Purchase/HR login may open (besides the static Labour app).
export function allowPurchaseHr(user: SessionUser) {
  if (user.role === "HR") redirect("/labour");
}

export function isPurchaseHr(user: SessionUser) {
  return user.role === "PURCHASE_HR";
}

export function isAdmin(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "SUPERADMIN";
}

export function canAccessUnit(user: SessionUser, unitId: string) {
  if (user.role === "SUPERADMIN") return true;
  return user.unitIds.includes(unitId);
}

export function assertUnitAccess(user: SessionUser, unitId: string) {
  if (!canAccessUnit(user, unitId)) {
    throw new Error("You do not have access to this unit.");
  }
}

// Prisma `where` fragment limiting a query to the user's units.
// Purchase/HR is a company-wide desk — they buy and hire for every unit.
export function unitScope(user: SessionUser): { unitId?: { in: string[] } } {
  if (user.role === "SUPERADMIN" || user.role === "PURCHASE_HR") return {};
  return { unitId: { in: user.unitIds } };
}
