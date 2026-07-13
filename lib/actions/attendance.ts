"use server";

import { revalidatePath } from "next/cache";
import { requireUser, isAdmin } from "@/lib/permissions";
import { processAttendanceEvent } from "@/lib/attendance/processor";

// Simulator for testing the attendance flow before the real biometric system
// is wired in. Goes through exactly the same processor as the webhook.
export async function simulateAttendanceEvent(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Only admins can simulate events.");
  const employeeCode = String(formData.get("employeeCode") ?? "").trim();
  const eventType = String(formData.get("eventType") ?? "") as "LOGIN" | "LOGOUT";
  if (!employeeCode || !["LOGIN", "LOGOUT"].includes(eventType)) return;

  await processAttendanceEvent({
    employeeCode,
    eventType,
    occurredAt: new Date(),
    raw: { simulatedBy: user.email },
  });
  revalidatePath("/attendance");
  revalidatePath("/");
}
