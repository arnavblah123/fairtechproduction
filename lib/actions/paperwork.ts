"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, isAccounts } from "@/lib/permissions";

// The accounts desk owns a job's paperwork: the PO number it was sold
// against, the PO value without GST, and the finished weight that every
// per-kg figure is built on. Admins keep the same rights — accounts is an
// extra pair of hands here, not a transfer of ownership.
export async function setJobPaperwork(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user) && !isAccounts(user)) {
    throw new Error("Only accounts and admins can edit a job's paperwork.");
  }
  const jobId = String(formData.get("jobId") ?? "");
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });

  const poNumber = String(formData.get("poNumber") ?? "").trim() || null;
  const poRaw = String(formData.get("poValue") ?? "").trim();
  const weightRaw = String(formData.get("finishedWeightKg") ?? "").trim();

  const poValue = poRaw ? Number(poRaw) : null;
  if (poValue !== null && (!isFinite(poValue) || poValue <= 0)) {
    throw new Error("PO value must be a number greater than 0.");
  }
  const finishedWeightKg = weightRaw ? Number(weightRaw) : null;
  if (finishedWeightKg !== null && (!isFinite(finishedWeightKg) || finishedWeightKg <= 0)) {
    throw new Error("Finished weight must be a number greater than 0.");
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      poNumber,
      finishedWeightKg,
      // A value arriving is the answer to "PO awaited" — clear the chase.
      ...(poValue !== null
        ? { poValue, poAwaited: false, poAwaitedAt: null, poExpectedBy: null }
        : { poValue }),
    },
  });
  await audit(user.id, "job.paperwork", "Job", jobId, {
    poNumber,
    poValue,
    finishedWeightKg,
    was: {
      poNumber: job.poNumber,
      poValue: job.poValue,
      finishedWeightKg: job.finishedWeightKg,
    },
  });
  revalidatePath("/accounts");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/");
}
