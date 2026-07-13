import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canAccessUnit } from "@/lib/permissions";

// Authenticated download of a job attachment (drawing / BOM). Unit-scoped:
// only users with access to the job's unit can fetch it.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = await db.jobAttachment.findUnique({
    where: { id },
    include: { job: { select: { unitId: true } } },
  });
  if (!attachment || !canAccessUnit(user, attachment.job.unitId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // RFC 5987 encoding so filenames with spaces/unicode download correctly.
  const encoded = encodeURIComponent(attachment.filename).replace(/'/g, "%27");
  return new NextResponse(Buffer.from(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
    },
  });
}
