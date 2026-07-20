"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin, assertUnitAccess } from "@/lib/permissions";

// Add a testing requirement to an existing job. The test gets its own timed
// stage, inserted right after the chosen stage (or at the end), so testing
// work is assigned and clocked like any other stage.
export async function addJobTest(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const afterStageId = String(formData.get("stageId") ?? "") || null;
  if (!name) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);
  if (job.status === "COMPLETED") return;

  const test = await db.$transaction(async (tx) => {
    let sequence: number;
    if (afterStageId) {
      const after = await tx.stage.findUniqueOrThrow({ where: { id: afterStageId } });
      if (after.jobId !== jobId) throw new Error("Stage belongs to a different job.");
      sequence = after.sequence + 1;
      await tx.stage.updateMany({
        where: { jobId, sequence: { gte: sequence } },
        data: { sequence: { increment: 1 } },
      });
    } else {
      const last = await tx.stage.findFirst({
        where: { jobId },
        orderBy: { sequence: "desc" },
      });
      sequence = (last?.sequence ?? 0) + 1;
    }
    const testStage = await tx.stage.create({
      data: { jobId, name, description: "Testing", sequence },
    });
    return tx.jobTest.create({ data: { jobId, stageId: testStage.id, name } });
  });
  await audit(user.id, "test.add", "JobTest", test.id, { jobId, name, stageId: test.stageId });
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
