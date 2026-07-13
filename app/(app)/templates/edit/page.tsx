import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { TemplateForm } from "@/components/template-form";

export const dynamic = "force-dynamic";

export default async function TemplateEditPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireRole("ADMIN", "SUPERADMIN");
  const { id } = await searchParams;
  const template = id
    ? await db.jobTemplate.findUnique({
        where: { id },
        include: { stages: { orderBy: { sequence: "asc" } } },
      })
    : null;

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-4">
        {template ? `Edit "${template.name}"` : "New Template"}
      </h1>
      <TemplateForm
        template={
          template
            ? {
                id: template.id,
                name: template.name,
                description: template.description ?? "",
                stagesText: template.stages
                  .map((s) => (s.description ? `${s.name} | ${s.description}` : s.name))
                  .join("\n"),
              }
            : null
        }
      />
    </div>
  );
}
