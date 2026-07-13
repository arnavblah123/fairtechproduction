import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { JobCreateForm } from "@/components/job-create-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const user = await requireRole("ADMIN", "SUPERADMIN");
  const [units, templates] = await Promise.all([
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.jobTemplate.findMany({
      where: { active: true },
      include: { stages: { orderBy: { sequence: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">New Job</h1>
      <JobCreateForm
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          stageNames: t.stages.map((s) => s.name),
        }))}
      />
    </div>
  );
}
