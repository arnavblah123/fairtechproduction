"use server";

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/permissions";
export type PasswordFormState = { error?: string; ok?: boolean } | undefined;

export async function changePassword(
  _prev: PasswordFormState,
  formData: FormData
): Promise<PasswordFormState> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "New passwords do not match." };

  const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(current, record.passwordHash))) {
    return { error: "Current password is incorrect." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(next, 10) },
  });
  await audit(user.id, "user.passwordChange", "User", user.id);
  return { ok: true };
}
