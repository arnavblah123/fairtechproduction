import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, canAccessUnit } from "@/lib/permissions";
import { JobEditForm } from "@/components/job-edit-form";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("ADMIN", "SUPERADMIN");
  const { id } = await params;
  const [job, units] = await Promise.all([
    db.job.findUnique({ where: { id } }),
    db.unit.findMany({
      where: user.role === "SUPERADMIN" ? {} : { id: { in: user.unitIds } },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!job || !canAccessUnit(user, job.unitId)) notFound();

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Edit Job</h1>
      <JobEditForm
        job={{
          id: job.id,
          clientName: job.clientName,
          buyerName: job.buyerName ?? "",
          poNumber: job.poNumber ?? "",
          description: job.description,
          expectedCompletion: job.expectedCompletion.toISOString().slice(0, 10),
          reminderDaysBefore: job.reminderDaysBefore,
          priority: job.priority,
          unitId: job.unitId,
        }}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
      />
    </div>
  );
}
