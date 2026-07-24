import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, isAdmin } from "@/lib/permissions";
import {
  createPlan,
  deletePlan,
  deletePlanItem,
  togglePlanItemDone,
  addFutureJob,
  deleteFutureJob,
} from "@/lib/actions/planning";
import { PlanItemForm } from "@/components/plan-item-form";
import { formatDate, jobCode } from "@/lib/format";

export const dynamic = "force-dynamic";

// Production planning (any date range). Superadmin plans; everyone sees the targets;
// supervisors add upcoming work to the backlog.

const DAY = 86400000;

export default async function PlanningPage() {
  const user = await requireUser();
  const owner = user.role === "SUPERADMIN";
  const admin = isAdmin(user);

  const [plans, openJobs, backlog, units] = await Promise.all([
    db.plan.findMany({
      include: {
        items: {
          orderBy: { targetDate: "asc" },
          include: {
            job: { select: { id: true, jobNumber: true, clientName: true, description: true } },
            stage: { select: { name: true, sequence: true, status: true } },
          },
        },
      },
      orderBy: { startDate: "desc" },
      take: 10,
    }),
    db.job.findMany({
      where: { status: { not: "COMPLETED" } },
      include: {
        stages: { orderBy: { sequence: "asc" }, select: { id: true, name: true, sequence: true, status: true } },
        unit: { select: { code: true } },
      },
      orderBy: { jobNumber: "asc" },
    }),
    db.futureJob.findMany({
      include: { unit: { select: { name: true, code: true } }, addedBy: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
  ]);

  const now = Date.now();
  const isItemDone = (item: (typeof plans)[0]["items"][0]) =>
    item.done || item.stage?.status === "DONE";
  const currentPlan =
    plans.find((p) => p.startDate.getTime() <= now && now <= p.endDate.getTime() + DAY) ??
    plans[0];
  const pastPlans = plans.filter((p) => p.id !== currentPlan?.id);

  const jobsForPicker = openJobs.map((j) => ({
    id: j.id,
    label: `${jobCode(j.jobNumber)} ${j.clientName} — ${j.description} (${j.unit.code})`,
    stages: j.stages.map((s) => ({
      id: s.id,
      label: `${s.sequence}. ${s.name}`,
      done: s.status === "DONE",
    })),
  }));

  function renderPlan(plan: typeof plans[0], isCurrent: boolean) {
    const doneCount = plan.items.filter(isItemDone).length;
    // Group items by job
    const groups = new Map<string, typeof plan.items>();
    for (const item of plan.items) {
      const key = item.job
        ? `${jobCode(item.job.jobNumber)} ${item.job.clientName} — ${item.job.description}`
        : "General";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return (
      <section
        key={plan.id}
        className={`bg-white rounded-xl shadow-sm p-4 space-y-3 ${
          isCurrent ? "ring-2 ring-indigo-300" : ""
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">
              {isCurrent && <span className="text-indigo-600 mr-1.5">▶</span>}
              {plan.name}
            </h2>
            <p className="text-xs text-slate-500">
              {formatDate(plan.startDate)} – {formatDate(plan.endDate)}
              {plan.notes && <> · {plan.notes}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-semibold ${
                doneCount === plan.items.length && plan.items.length > 0
                  ? "text-green-700"
                  : "text-slate-600"
              }`}
            >
              {doneCount}/{plan.items.length} done
            </span>
            {owner && (
              <form action={deletePlan}>
                <input type="hidden" name="planId" value={plan.id} />
                <button className="text-xs text-red-600 hover:underline">delete plan</button>
              </form>
            )}
          </div>
        </div>

        {[...groups.entries()].map(([label, items]) => (
          <div key={label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
              {items[0].job ? (
                <Link href={`/jobs/${items[0].job.id}`} className="hover:underline">
                  {label}
                </Link>
              ) : (
                label
              )}
            </p>
            <ul className="space-y-1">
              {items.map((item) => {
                const done = isItemDone(item);
                const overdue = !done && item.targetDate.getTime() + DAY < now;
                return (
                  <li
                    key={item.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                      done
                        ? "bg-green-50 text-green-900"
                        : overdue
                        ? "bg-red-50 text-red-900"
                        : "bg-slate-50"
                    }`}
                  >
                    <span>{done ? "✅" : overdue ? "🔴" : "⬜"}</span>
                    <span className={done ? "line-through opacity-70" : ""}>
                      {item.stage ? `${item.stage.sequence}. ` : ""}
                      {item.description}
                    </span>
                    <span className={`ml-auto text-xs whitespace-nowrap ${overdue ? "font-bold" : "text-slate-500"}`}>
                      by {formatDate(item.targetDate)}
                      {overdue && " — LATE"}
                    </span>
                    {owner && (
                      <span className="flex gap-1.5">
                        {!item.stage && (
                          <form action={togglePlanItemDone}>
                            <input type="hidden" name="itemId" value={item.id} />
                            <button className="text-xs text-green-700 hover:underline">
                              {item.done ? "undo" : "tick"}
                            </button>
                          </form>
                        )}
                        <form action={deletePlanItem}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <button className="text-xs text-red-600 hover:underline">✕</button>
                        </form>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {plan.items.length === 0 && (
          <p className="text-sm text-slate-400">No targets yet.</p>
        )}
        {owner && <PlanItemForm planId={plan.id} jobs={jobsForPicker} />}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Production Planning</h1>
        {!owner && (
          <span className="text-xs text-slate-500">
            Planning is set by management — check your unit&apos;s targets daily.
          </span>
        )}
      </div>

      {/* New plan (owner only) */}
      {owner && (
        <details className="bg-white rounded-xl shadow-sm">
          <summary className="cursor-pointer select-none px-4 py-3 font-semibold text-indigo-700">
            + New plan
          </summary>
          <form action={createPlan} className="px-4 pb-4 flex flex-wrap items-end gap-2 text-sm">
            <label className="block">
              <span className="block text-xs text-slate-500 mb-0.5">Start</span>
              <input type="date" name="startDate" required className="rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="block text-xs text-slate-500 mb-0.5">End</span>
              <input type="date" name="endDate" required className="rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="block flex-1 min-w-40">
              <span className="block text-xs text-slate-500 mb-0.5">Notes (optional)</span>
              <input name="notes" className="w-full rounded-lg border border-slate-300 px-2 py-1.5" />
            </label>
            <button className="rounded-lg bg-indigo-600 text-white px-4 py-1.5 font-medium">
              Create plan
            </button>
          </form>
        </details>
      )}

      {currentPlan ? (
        renderPlan(currentPlan, true)
      ) : (
        <p className="bg-white rounded-xl shadow-sm p-6 text-center text-slate-400 text-sm">
          No plan yet{owner ? " — create the first plan above." : "."}
        </p>
      )}

      {/* Future jobs backlog */}
      <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold">Upcoming work (future jobs)</h2>
        <p className="text-xs text-slate-500">
          Know of work that will start soon? Add it here so it is counted in the
          next planning. When the PO arrives, create the real job from it.
        </p>
        <ul className="space-y-1.5">
          {backlog.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-2 bg-amber-50 rounded-lg px-3 py-2 text-sm"
            >
              <span className="font-medium">{f.clientName}</span>
              <span>— {f.description}</span>
              {f.unit && <span className="text-xs text-slate-500">{f.unit.code}</span>}
              {f.expectedStart && (
                <span className="text-xs text-amber-800 whitespace-nowrap">
                  expected {formatDate(f.expectedStart)}
                </span>
              )}
              {f.notes && <span className="text-xs text-slate-500">· {f.notes}</span>}
              <span className="text-[10px] text-slate-400">by {f.addedBy.name}</span>
              <span className="ml-auto flex gap-2">
                <Link
                  href={`/jobs/new?client=${encodeURIComponent(f.clientName)}&desc=${encodeURIComponent(f.description)}${f.unitId ? `&unit=${f.unitId}` : ""}`}
                  className="text-xs text-blue-700 hover:underline whitespace-nowrap"
                >
                  Create job →
                </Link>
                {admin && (
                  <form action={deleteFutureJob}>
                    <input type="hidden" name="futureJobId" value={f.id} />
                    <button className="text-xs text-red-600 hover:underline">✕</button>
                  </form>
                )}
              </span>
            </li>
          ))}
          {backlog.length === 0 && (
            <li className="text-sm text-slate-400">Nothing in the backlog.</li>
          )}
        </ul>
        <form action={addFutureJob} className="flex flex-wrap items-center gap-1.5 text-sm">
          <input name="clientName" required placeholder="Client *" className="rounded-lg border border-slate-300 px-2 py-1.5 w-36" />
          <input name="description" required placeholder="What equipment? *" className="rounded-lg border border-slate-300 px-2 py-1.5 w-44" />
          <select name="unitId" className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">Unit?</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.code}</option>
            ))}
          </select>
          <input type="date" name="expectedStart" title="Expected start" className="rounded-lg border border-slate-300 px-2 py-1.5" />
          <input name="notes" placeholder="Notes" className="rounded-lg border border-slate-300 px-2 py-1.5 w-36" />
          <button className="rounded-lg bg-amber-600 text-white px-3 py-1.5 font-medium">
            + Add future job
          </button>
        </form>
      </section>

      {/* Past plans */}
      {pastPlans.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-500 px-1">
            Past plans ({pastPlans.length})
          </summary>
          <div className="mt-2 space-y-3">{pastPlans.map((p) => renderPlan(p, false))}</div>
        </details>
      )}
    </div>
  );
}
