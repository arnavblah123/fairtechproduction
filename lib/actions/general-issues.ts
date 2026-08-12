"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, assertUnitAccess } from "@/lib/permissions";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";
import { sendOwnerEmail } from "@/lib/email";

// Factory-level problems — electricity, crane vendor, water, anything that
// belongs to no particular job. Anyone who can log in to production may
// raise one; the owner and Jagdish hear about it the same way as job issues.

export async function raiseGeneralIssue(formData: FormData) {
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;
  const unitId = String(formData.get("unitId") ?? "") || null;
  const user = await requireUser();
  if (unitId) assertUnitAccess(user, unitId);

  const issue = await db.generalIssue.create({
    data: { description, unitId, raisedById: user.id },
    include: { unit: { select: { name: true } } },
  });

  // Alert + history run after the response — the tap must not wait on Meta.
  after(async () => {
    await audit(user.id, "generalIssue.raise", "GeneralIssue", issue.id, { unitId }).catch(
      (e) => console.error("audit failed:", e)
    );
    try {
      const text =
        `🏭 Factory problem raised\n\n` +
        `Problem: ${description}\n` +
        `Where: ${issue.unit?.name ?? "All units / general"}\n` +
        `Raised by: ${user.name}`;
      if (whatsappConfigured()) {
        await sendWhatsApp(text);
      } else {
        await sendOwnerEmail(
          `🏭 Factory problem: ${description.slice(0, 80)}`,
          `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
             <h2 style="margin-bottom:4px">🏭 Factory problem raised</h2>
             <p style="white-space:pre-line;margin:0">${text.split("\n").slice(2).join("\n")}</p>
           </div>`
        );
      }
    } catch (err) {
      console.error("general issue alert failed:", err);
    }
  });
  revalidatePath("/issues");
  revalidatePath("/");
}

export async function resolveGeneralIssue(formData: FormData) {
  const issueId = String(formData.get("issueId") ?? "");
  const [user, issue] = await Promise.all([
    requireUser(),
    db.generalIssue.findUniqueOrThrow({ where: { id: issueId } }),
  ]);
  if (issue.unitId) assertUnitAccess(user, issue.unitId);
  await db.generalIssue.update({
    where: { id: issueId },
    data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: new Date() },
  });
  after(() =>
    audit(user.id, "generalIssue.resolve", "GeneralIssue", issueId).catch((e) =>
      console.error("audit failed:", e)
    )
  );
  revalidatePath("/issues");
  revalidatePath("/");
}
