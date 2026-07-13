"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser, isAdmin } from "@/lib/permissions";
import type { FormState } from "./auth";

// Create or update a template. Stages come in as one per line
// ("Stage name | optional description"). Edits never touch jobs already
// created from the template (jobs copy stages at creation time).
export async function saveTemplate(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  if (!isAdmin(user)) return { error: "Only admins can manage templates." };

  const templateId = String(formData.get("templateId") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const stagesRaw = String(formData.get("stages") ?? "");

  if (!name) return { error: "Template name is required." };
  const stages = stagesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [stageName, stageDesc] = line.split("|").map((s) => s.trim());
      return { name: stageName, description: stageDesc || null, sequence: i + 1 };
    });
  if (stages.length === 0) return { error: "At least one stage is required." };

  const clash = await db.jobTemplate.findUnique({ where: { name } });
  if (clash && clash.id !== templateId) {
    return { error: `A template named "${name}" already exists.` };
  }

  if (templateId) {
    await db.$transaction(async (tx) => {
      await tx.templateStage.deleteMany({ where: { templateId } });
      await tx.jobTemplate.update({
        where: { id: templateId },
        data: { name, description, stages: { create: stages } },
      });
      await audit(user.id, "template.update", "JobTemplate", templateId, { name }, tx);
    });
  } else {
    const created = await db.jobTemplate.create({
      data: { name, description, stages: { create: stages } },
    });
    await audit(user.id, "template.create", "JobTemplate", created.id, { name });
  }
  revalidatePath("/templates");
  redirect("/templates");
}

export async function setTemplateActive(formData: FormData) {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error("Not allowed");
  const templateId = String(formData.get("templateId") ?? "");
  const active = formData.get("active") === "true";
  await db.jobTemplate.update({ where: { id: templateId }, data: { active } });
  await audit(user.id, active ? "template.activate" : "template.deactivate", "JobTemplate", templateId);
  revalidatePath("/templates");
}
