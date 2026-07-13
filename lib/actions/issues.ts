"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";
import type { IssueType } from "@prisma/client";

export async function raiseIssue(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const type = String(formData.get("type") ?? "OTHER") as IssueType;
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);

  const issue = await db.issue.create({
    data: { jobId, unitId: job.unitId, type, description, raisedById: user.id },
  });
  await audit(user.id, "issue.raise", "Issue", issue.id, { jobId, type });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/issues");
  revalidatePath("/");
}

export async function resolveIssue(formData: FormData) {
  const user = await requireUser();
  const issueId = String(formData.get("issueId") ?? "");
  const issue = await db.issue.findUniqueOrThrow({ where: { id: issueId } });
  assertUnitAccess(user, issue.unitId);
  await db.issue.update({
    where: { id: issueId },
    data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: new Date() },
  });
  await audit(user.id, "issue.resolve", "Issue", issueId);
  revalidatePath(`/jobs/${issue.jobId}`);
  revalidatePath("/issues");
  revalidatePath("/");
}
