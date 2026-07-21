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

  if (units.length === 0) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6 text-center space-y-2">
        <p className="text-3xl">🚫</p>
        <h1 className="font-bold">No unit assigned to your account</h1>
        <p className="text-sm text-slate-600">
          Jobs are created inside a unit, and your login has no unit attached.
          Ask the admin to open <b>Users</b> and tick your unit — then this
          page will work.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">New Job</h1>
      <JobCreateForm
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          equipmentName: t.equipmentName,
          stageNames: t.stages.map((s) => s.name),
        }))}
        clientNames={clients.map((c) => c.clientName)}
        buyerNames={buyers.map((b) => b.buyerName!).filter(Boolean)}
      />
    </div>
  );
}
