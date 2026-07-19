import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { setTemplateActive } from "@/lib/actions/templates";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireRole("ADMIN", "SUPERADMIN");
  const templates = await db.jobTemplate.findMany({
    include: {
      stages: { orderBy: { sequence: "asc" } },
      _count: { select: { jobs: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Process Library (Job Templates)</h1>
        <Link
          href="/templates/edit"
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          + New Template
        </Link>
      </div>
      <p className="text-sm text-slate-500">
        Editing a template never changes jobs already created from it — jobs copy
        their stages at creation time.
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`bg-white rounded-xl shadow-sm p-4 ${!t.active ? "opacity-60" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{t.name}</h2>
              <span className="text-xs text-slate-400 whitespace-nowrap">
                {t._count.jobs} job{t._count.jobs === 1 ? "" : "s"}
              </span>
            </div>
            {t.equipmentName && (
              <p className="text-xs mt-1">
                <span className="inline-flex rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 font-medium">
                  For: {t.equipmentName}
                </span>
              </p>
            )}
            {t.description && <p className="text-sm text-slate-500 mt-1">{t.description}</p>}
            <ol className="mt-3 text-sm text-slate-600 list-decimal list-inside space-y-0.5">
              {t.stages.map((s) => (
                <li key={s.id}>{s.name}</li>
              ))}
            </ol>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/templates/edit?id=${t.id}`}
                className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-sm font-medium"
              >
                Edit
              </Link>
              <form action={setTemplateActive}>
                <input type="hidden" name="templateId" value={t.id} />
                <input type="hidden" name="active" value={String(!t.active)} />
                <button className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-sm font-medium">
                  {t.active ? "Archive" : "Restore"}
                </button>
              </form>
            </div>
          </div>
        ))}
        {templates.length === 0 && (
          <p className="text-slate-400">No templates yet. Create one, or save stages as a template while creating a job.</p>
        )}
      </div>
    </div>
  );
}
