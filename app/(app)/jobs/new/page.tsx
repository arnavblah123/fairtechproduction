import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { JobCreateForm } from "@/components/job-create-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const user = await requireUser();
  const [units, templates, clients, buyers] = await Promise.all([
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
    db.jobTemplate.findMany({
      where: { active: true },
      include: { stages: { orderBy: { sequence: "asc" } } },
      orderBy: { name: "asc" },
    }),
    // Previously used names, so spellings stay consistent across jobs.
    db.job.findMany({
      distinct: ["clientName"],
      select: { clientName: true },
      orderBy: { clientName: "asc" },
    }),
    db.job.findMany({
      where: { buyerName: { not: null } },
      distinct: ["buyerName"],
      select: { buyerName: true },
      orderBy: { buyerName: "asc" },
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
        clientNames={clients.map((c) => c.clientName)}
        buyerNames={buyers.map((b) => b.buyerName!).filter(Boolean)}
      />
    </div>
  );
}
