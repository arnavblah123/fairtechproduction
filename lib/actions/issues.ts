"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";
import { sendIssueAlert } from "@/lib/issue-alert";
import type { IssueType } from "@prisma/client";

export async function raiseIssue(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const type = String(formData.get("type") ?? "OTHER") as IssueType;
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  const [user, job] = await Promise.all([
    requireUser(),
    db.job.findUniqueOrThrow({ where: { id: jobId } }),
  ]);
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
  // The WhatsApp/email alert and the history write go out after the
  // response — the person raising the issue shouldn't wait on Meta's API.
  after(async () => {
    await audit(user.id, "issue.raise", "Issue", issue.id, { jobId, type }).catch((e) =>
      console.error("audit failed:", e)
    );
    await sendIssueAlert(issue.id); // best-effort internally, never throws
  });
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/issues");
  revalidatePath("/labour-requests");
  revalidatePath("/");
}

export async function resolveIssue(formData: FormData) {
  const issueId = String(formData.get("issueId") ?? "");
  const [user, issue] = await Promise.all([
    requireUser(),
    db.issue.findUniqueOrThrow({ where: { id: issueId } }),
  ]);
  assertUnitAccess(user, issue.unitId);
  await db.issue.update({
    where: { id: issueId },
    data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: new Date() },
  });
  after(() =>
    audit(user.id, "issue.resolve", "Issue", issueId).catch((e) =>
      console.error("audit failed:", e)
    )
  );
  revalidatePath(`/jobs/${issue.jobId}`);
  revalidatePath("/issues");
  revalidatePath("/labour-requests");
  revalidatePath("/");
}
