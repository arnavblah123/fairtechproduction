"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";
import { DISCIPLINE_HOURS } from "@/lib/discipline";
import type { DisciplineReason } from "@prisma/client";
import type { FormState } from "./auth";

// Record a disciplinary hour cut against a worker. Hours are fixed per
// reason (drinking 16, timepass 8, tobacco 4) — only OTHER takes a custom
// figure, and then a note saying what happened is compulsory.
export async function addDiscipline(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const employeeId = String(formData.get("employeeId") ?? "");
  const reason = String(formData.get("reason") ?? "") as DisciplineReason;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!["DRINKING", "TIMEPASS", "TOBACCO", "OTHER"].includes(reason)) {
    return { error: "Choose a reason." };
  }
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  assertUnitAccess(user, employee.primaryUnitId);

  let hoursCut: number;
  if (reason === "OTHER") {
    hoursCut = Number(formData.get("hours"));
    if (!Number.isFinite(hoursCut) || hoursCut <= 0 || hoursCut > 200) {
      return { error: "Enter a valid number of hours to cut." };
    }
    if (!note) return { error: "For 'Other', write what happened." };
  } else {
    hoursCut = DISCIPLINE_HOURS[reason];
  }

  const entry = await db.discipline.create({
    data: {
      employeeId,
      unitId: employee.primaryUnitId,
      reason,
      hoursCut,
      note,
      raisedById: user.id,
    },
  });
  await audit(user.id, "discipline.add", "Discipline", entry.id, {
    employeeId,
    employeeCode: employee.code,
    reason,
    hoursCut,
    note,
  });
  revalidatePath("/employees");
  revalidatePath("/discipline");
  return undefined;
}

// Remove a wrong entry — admins only, audit-logged.
export async function deleteDiscipline(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Only admins can remove discipline entries.");
  const id = String(formData.get("disciplineId") ?? "");
  const entry = await db.discipline.findUniqueOrThrow({ where: { id } });
  assertUnitAccess(user, entry.unitId);
  await db.discipline.delete({ where: { id } });
  await audit(user.id, "discipline.delete", "Discipline", id, {
    employeeId: entry.employeeId,
    reason: entry.reason,
    hoursCut: entry.hoursCut,
  });
  revalidatePath("/employees");
  revalidatePath("/discipline");
}
