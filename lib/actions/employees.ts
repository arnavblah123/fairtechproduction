"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";
import type { FormState } from "./auth";

// Fast 30-second quick-add: name, skill, unit, contact. Code auto-generated
// if not provided.
export async function quickAddEmployee(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const skill = String(formData.get("skill") ?? "").trim();
  const unitId = String(formData.get("unitId") ?? "");
  const contact = String(formData.get("contact") ?? "").trim() || null;
  let code = String(formData.get("code") ?? "").trim();

  if (!name || !skill || !unitId) {
    return { error: "Name, skill and unit are required." };
  }
  assertUnitAccess(user, unitId);

  if (!code) {
    const count = await db.employee.count();
    code = `EMP${String(count + 1).padStart(3, "0")}`;
    // avoid rare collision with manually chosen codes
    while (await db.employee.findUnique({ where: { code } })) {
      code = `EMP${String(Number(code.slice(3)) + 1).padStart(3, "0")}`;
    }
  } else if (await db.employee.findUnique({ where: { code } })) {
    return { error: `Employee code "${code}" is already in use.` };
  }

  const employee = await db.employee.create({
    data: {
      name,
      code,
      skill,
      contact,
      primaryUnitId: unitId,
      transfers: { create: { toUnitId: unitId } },
    },
  });
  await audit(user.id, "employee.create", "Employee", employee.id, {
    name,
    code,
    unitId,
  });
  revalidatePath("/employees");
  return undefined;
}

export async function transferEmployee(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user) && user.role !== "SUPERVISOR") throw new Error("Not allowed");
  const employeeId = String(formData.get("employeeId") ?? "");
  const toUnitId = String(formData.get("toUnitId") ?? "");
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  assertUnitAccess(user, employee.primaryUnitId);
  assertUnitAccess(user, toUnitId);
  if (employee.primaryUnitId === toUnitId) return;

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.unitTransfer.updateMany({
      where: { employeeId, toDate: null },
      data: { toDate: now },
    });
    await tx.unitTransfer.create({
      data: {
        employeeId,
        fromUnitId: employee.primaryUnitId,
        toUnitId,
        fromDate: now,
      },
    });
    await tx.employee.update({
      where: { id: employeeId },
      data: { primaryUnitId: toUnitId },
    });
    await audit(
      user.id,
      "employee.transfer",
      "Employee",
      employeeId,
      { from: employee.primaryUnitId, to: toUnitId },
      tx
    );
  });
  revalidatePath("/employees");
}

export async function setEmployeeActive(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Not allowed");
  const employeeId = String(formData.get("employeeId") ?? "");
  const active = formData.get("active") === "true";
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  assertUnitAccess(user, employee.primaryUnitId);
  await db.employee.update({ where: { id: employeeId }, data: { active } });
  await audit(user.id, active ? "employee.activate" : "employee.deactivate", "Employee", employeeId);
  revalidatePath("/employees");
}
