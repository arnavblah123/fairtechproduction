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
export function unitScope(user: SessionUser): { unitId?: { in: string[] } } {
  if (user.role === "SUPERADMIN") return {};
  return { unitId: { in: user.unitIds } };
}
