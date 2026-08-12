"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";

// Reusing a drawing from an earlier job.
//
// The same part is often built again for the same customer, and the drawing
// is identical — but not always. So the supervisor must answer one question
// before the old drawing can be attached. If there is any doubt, nothing is
// attached and the job is flagged instead, because building to last month's
// drawing is far more expensive than uploading a new file.

export async function reuseDrawing(formData: FormData) {
  const user = await requireUser();
  const toJobId = String(formData.get("toJobId") ?? "");
  const fromJobId = String(formData.get("fromJobId") ?? "");
  const answer = String(formData.get("answer") ?? ""); // "same" | "changed"
  if (!toJobId || !fromJobId || !answer) return;

  const [toJob, fromJob] = await Promise.all([
    db.job.findUniqueOrThrow({
      where: { id: toJobId },
      include: { unit: { select: { id: true } } },
    }),
    db.job.findUniqueOrThrow({ where: { id: fromJobId } }),
  ]);
  assertUnitAccess(user, toJob.unitId);

  if (answer === "same") {
    const drawings = await db.jobAttachment.findMany({
      where: { jobId: fromJobId, kind: "DRAWING" },
      select: { id: true, filename: true },
    });
    if (drawings.length === 0) return;
    // The file keeps the name of the job it was drawn for; sourceJobId records
    // where it came from so the job page can say so. The copy happens inside
    // Postgres — the drawing bytes never travel to the app server.
    await db.$executeRaw`
      INSERT INTO "JobAttachment"
        ("id", "jobId", "kind", "filename", "mimeType", "size", "data", "sourceJobId", "uploadedById")
      SELECT gen_random_uuid()::text, ${toJobId}, "kind", "filename", "mimeType", "size", "data", ${fromJobId}, ${user.id}
      FROM "JobAttachment"
      WHERE "jobId" = ${fromJobId} AND "kind" = 'DRAWING'::"AttachmentKind"`;
    await db.job.update({ where: { id: toJobId }, data: { drawingPending: false } });
    await db.todoItem.updateMany({
      where: { jobId: toJobId, done: false, message: { startsWith: "Upload updated drawing" } },
      data: { done: true, doneBy: user.name, doneAt: new Date() },
    });
    await audit(user.id, "drawing.reuse", "Job", toJobId, {
      fromJobId,
      files: drawings.map((d) => d.filename),
      confirmed: "no changes",
    });
  } else {
    // Not sure, or there are changes: attach nothing, flag the job, and put a
    // reminder in the supervisor's own morning list.
    await db.job.update({ where: { id: toJobId }, data: { drawingPending: true } });
    const message = `Upload updated drawing for ${toJob.description}`;
    const existing = await db.todoItem.findFirst({
      where: { jobId: toJobId, done: false, message },
    });
    if (!existing) {
      await db.todoItem.create({
        data: {
          message,
          jobId: toJobId,
          unitId: toJob.unitId,
          createdById: user.id,
        },
      });
    }
    await audit(user.id, "drawing.reuseDeclined", "Job", toJobId, {
      fromJobId,
      reason: "supervisor said the drawing may have changed",
    });
  }
  revalidatePath(`/jobs/${toJobId}`);
  revalidatePath("/todo");
  revalidatePath("/");
  void fromJob;
}
