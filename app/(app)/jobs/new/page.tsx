import { db } from "@/lib/db";
import { requireUser, allowAccounts, seesAllUnits } from "@/lib/permissions";
import { JobCreateForm } from "@/components/job-create-form";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; desc?: string; unit?: string; from?: string }>;
}) {
  const user = await requireUser();
  allowAccounts(user); // the accounts desk books orders from this same form
  const { client, desc, unit, from } = await searchParams;
  // ?from=<order book id> — releasing a booked order into production. Every
  // field it already holds is filled in, and the booking is deleted when the
  // job is created.
  const booked = from
    ? await db.futureJob.findUnique({ where: { id: from } })
    : null;
  const [units, templates, clients, buyers, names] = await Promise.all([
    db.unit.findMany({
      where: seesAllUnits(user) ? {} : { id: { in: user.unitIds } },
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
    // Job names already used — typing the same one back brings up what it
    // was built as last time.
    db.job.findMany({
      distinct: ["description"],
      select: { description: true },
      orderBy: { description: "asc" },
      take: 500,
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
      <h1 className="text-xl font-bold mb-4">
        {booked ? "Release Order to Production" : "New Job"}
      </h1>
      {booked && (
        <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Booked for <b>{booked.clientName}</b>. Check the details, add drawings,
          material and testing, and creating the job removes it from the order book.
        </p>
      )}
      <JobCreateForm
        fromFutureJobId={booked?.id}
        units={units.map((u) => ({ id: u.id, name: u.name }))}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          equipmentName: t.equipmentName,
          stageNames: t.stages.map((s) => s.name),
        }))}
        clientNames={clients.map((c) => c.clientName)}
        buyerNames={buyers.map((b) => b.buyerName!).filter(Boolean)}
        jobNames={names.map((n) => n.description)}
        prefill={{
          clientName: booked?.clientName ?? client ?? "",
          description: booked?.description ?? desc ?? "",
          unitId: booked?.unitId ?? unit ?? "",
          buyerName: booked?.buyerName ?? undefined,
          poNumber: booked?.poNumber ?? undefined,
          expectedCompletion:
            booked?.expectedCompletion?.toISOString().slice(0, 10) ?? undefined,
          finishedWeightKg: booked?.finishedWeightKg?.toString() ?? undefined,
          reminderDaysBefore: booked?.reminderDaysBefore?.toString() ?? undefined,
          priority: booked?.priority ?? undefined,
          templateId: booked?.templateId ?? undefined,
          stagesText: booked?.stagesText ?? undefined,
        }}
      />
    </div>
  );
}
