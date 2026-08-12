"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/permissions";

// Findings are the owner's own panel: only the superadmin may act on them.
export async function acknowledgeFinding(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") throw new Error("Not allowed");
  const findingId = String(formData.get("findingId") ?? "");
  await db.dailyFinding.update({
    where: { id: findingId },
    data: { acknowledged: true },
  });
  after(() =>
    audit(user.id, "finding.acknowledge", "DailyFinding", findingId).catch((e) =>
      console.error("audit failed:", e)
    )
  );
  revalidatePath("/");
}
