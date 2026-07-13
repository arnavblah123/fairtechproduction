"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import type { FormState } from "./auth";

// User management rules (spec §1):
//   - Superadmin manages everyone, can promote/demote admins.
//   - Admins may create/manage supervisors for their own units, but never
//     other admins or the superadmin.
function canManage(actorRole: Role, targetRole: Role) {
  if (actorRole === "SUPERADMIN") return targetRole !== "SUPERADMIN";
  if (actorRole === "ADMIN") return targetRole === "SUPERVISOR";
  return false;
}

export async function createUser(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const actor = await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "SUPERVISOR") as Role;
  const unitIds = formData.getAll("unitIds").map(String).filter(Boolean);

  if (!canManage(actor.role, role)) return { error: "You cannot create users with that role." };
  if (!email || !name || !password) return { error: "Email, name and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (unitIds.length === 0) return { error: "Assign at least one unit." };
  if (actor.role === "ADMIN" && unitIds.some((u) => !actor.unitIds.includes(u))) {
    return { error: "You can only assign units you have access to." };
  }
  if (await db.user.findUnique({ where: { email } })) {
    return { error: "A user with that email already exists." };
  }

  const user = await db.user.create({
    data: {
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(password, 10),
      units: { create: unitIds.map((unitId) => ({ unitId })) },
    },
  });
  await audit(actor.id, "user.create", "User", user.id, { email, role, unitIds });
  revalidatePath("/users");
  return undefined;
}

export async function updateUserRole(formData: FormData) {
  const actor = await requireUser();
  if (actor.role !== "SUPERADMIN") throw new Error("Only the superadmin can change roles.");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  const target = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === "SUPERADMIN" || role === "SUPERADMIN") {
    throw new Error("Superadmin role cannot be changed here.");
  }
  await db.user.update({ where: { id: userId }, data: { role } });
  await audit(actor.id, "user.role", "User", userId, { role });
  revalidatePath("/users");
}

export async function setUserUnits(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const unitIds = formData.getAll("unitIds").map(String).filter(Boolean);
  const target = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canManage(actor.role, target.role)) throw new Error("Not allowed");
  if (actor.role === "ADMIN" && unitIds.some((u) => !actor.unitIds.includes(u))) {
    throw new Error("You can only assign units you have access to.");
  }
  await db.$transaction([
    db.userUnit.deleteMany({ where: { userId } }),
    db.userUnit.createMany({ data: unitIds.map((unitId) => ({ userId, unitId })) }),
  ]);
  await audit(actor.id, "user.units", "User", userId, { unitIds });
  revalidatePath("/users");
}

export async function setUserActive(formData: FormData) {
  const actor = await requireUser();
  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "true";
  const target = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!canManage(actor.role, target.role)) throw new Error("Not allowed");
  await db.user.update({ where: { id: userId }, data: { active } });
  await audit(actor.id, active ? "user.activate" : "user.deactivate", "User", userId);
  revalidatePath("/users");
}
