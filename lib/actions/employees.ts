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
  // Quick-add can be embedded on other pages (e.g. a job page) — refresh
  // that page too so the new worker appears in its dropdowns immediately.
  const alsoRevalidate = String(formData.get("alsoRevalidate") ?? "");
  if (alsoRevalidate.startsWith("/")) revalidatePath(alsoRevalidate);
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

// Map a worker to their enrollment number (PIN) in the biometric machine.
export async function setBiometricId(formData: FormData) {
  const user = await requireUser();
  const employeeId = String(formData.get("employeeId") ?? "");
  const biometricId = String(formData.get("biometricId") ?? "").trim() || null;
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  assertUnitAccess(user, employee.primaryUnitId);
  if (biometricId) {
    const clash = await db.employee.findUnique({ where: { biometricId } });
    if (clash && clash.id !== employeeId) {
      throw new Error(
        `Bio #${biometricId} is already assigned to ${clash.name}. Each machine number maps to one worker.`
      );
    }
  }
  await db.employee.update({ where: { id: employeeId }, data: { biometricId } });
  await audit(user.id, "employee.biometricId", "Employee", employeeId, { biometricId });
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
