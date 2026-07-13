import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import {
  COOKIE_NAME,
  signSessionToken,
  verifySessionToken,
} from "@/lib/session-token";

export async function createSession(userId: string) {
  const token = await signSessionToken(userId);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  unitIds: string[]; // units the user is scoped to; superadmin gets all
};

// Cached per-request. Returns null when not logged in.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    include: { units: true },
  });
  if (!user || !user.active) return null;
  let unitIds = user.units.map((u) => u.unitId);
  if (user.role === "SUPERADMIN") {
    const all = await db.unit.findMany({ select: { id: true } });
    unitIds = all.map((u) => u.id);
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    unitIds,
  };
});
