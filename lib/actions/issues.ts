"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";
import { sendIssueAlert } from "@/lib/issue-alert";
import type { IssueType } from "@prisma/client";

export async function raiseIssue(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const type = String(formData.get("type") ?? "OTHER") as IssueType;
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  assertUnitAccess(user, job.unitId);

  const issue = await db.issue.create({
    data: {
      jobId,
      unitId: job.unitId,
      type,
      description,
      dueAt: dueAt && !isNaN(dueAt.getTime()) ? dueAt : null,
      raisedById: user.id,
    },
  });
  await audit(user.id, "issue.raise", "Issue", issue.id, { jobId, type });
  // Straight to Jagdish and the owner on WhatsApp.
  await sendIssueAlert(issue.id);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/issues");
  revalidatePath("/labour-requests");
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
  revalidatePath("/labour-requests");
  revalidatePath("/");
}
