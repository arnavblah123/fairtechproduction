"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";

// Add a testing requirement to an existing job.
export async function addJobTest(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const stageId = String(formData.get("stageId") ?? "") || null;
  if (!name) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (job.status === "COMPLETED") return;
  if (stageId) {
    const stage = await db.stage.findUniqueOrThrow({ where: { id: stageId } });
    if (stage.jobId !== jobId) return;
  }
  const test = await db.jobTest.create({ data: { jobId, stageId, name } });
  await audit(user.id, "test.add", "JobTest", test.id, { jobId, name, stageId });
  revalidatePath(`/jobs/${jobId}`);
}

export async function deleteJobTest(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Only admins can remove testing requirements.");
  const testId = String(formData.get("testId") ?? "");
  const test = await db.jobTest.findUniqueOrThrow({
    where: { id: testId },
    include: { job: true },
  });
  assertUnitAccess(user, test.job.unitId);
  await db.jobTest.delete({ where: { id: testId } });
  await audit(user.id, "test.delete", "JobTest", testId, {
    jobId: test.jobId,
    name: test.name,
  });
  revalidatePath(`/jobs/${test.jobId}`);
}
