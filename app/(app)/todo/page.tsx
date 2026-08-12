import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, lockHrToLabour } from "@/lib/permissions";
import { buildTodoData } from "@/lib/todo";
import {
  addOwnerTodo,
  toggleTodoDone,
  deleteOwnerTodo,
  setJobPoNumber,
  setJobEstimatedDispatch,
  copyDrawings,
  markPoAwaited,
} from "@/lib/actions/todo";
import { stopWorker } from "@/lib/actions/stages";
import { TodoTick } from "@/components/todo-tick";
import { formatDate, formatDateTime, jobCode } from "@/lib/format";
import { LiveDuration } from "@/components/live-duration";
import { SearchSelect } from "@/components/search-select";
import { LateReasonForm } from "@/components/late-reason-form";

export const dynamic = "force-dynamic";

// The morning list. Rebuilt live: whatever is still pending shows up, every
// day, until it's handled. Owner can add items of their own.
export default async function TodoPage() {
  const user = await requireUser();
  lockHrToLabour(user);
  const owner = user.role === "SUPERADMIN";
  const data = await buildTodoData(user);

  const ownerPickJobs = owner
    ? await db.job.findMany({
        where: { status: { not: "COMPLETED" } },
        select: { id: true, jobNumber: true, description: true, clientName: true },
        orderBy: { jobNumber: "desc" },
        take: 100,
      })
    : [];
  const units = owner ? await db.unit.findMany({ orderBy: { name: "asc" } }) : [];

  // Workers offered when a delay is blamed on labour.
  const workerOptions = (
    await db.employee.findMany({
      where: { active: true, ...(owner ? {} : { primaryUnitId: { in: user.unitIds } }) },
      select: { id: true, name: true, skill: true, primaryUnit: { select: { code: true } } },
      orderBy: { name: "asc" },
    })
  ).map((e) => ({ id: e.id, name: e.name, skill: e.skill, unitCode: e.primaryUnit.code }));

  const jobLabel = (j: { jobNumber: number; description: string }) =>
    `${j.description} (${jobCode(j.jobNumber)})`;

  const Section = ({
    title,
    children,
    count,
  }: {
    title: string;
    count: number;
    children: React.ReactNode;
  }) =>
    count === 0 ? null : (
      <section className="bg-white rounded-xl shadow-sm p-4 space-y-2">
        <h2 className="font-semibold">
          {title} <span className="text-slate-400 font-normal">({count})</span>
        </h2>
        {children}
      </section>
    );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">📋 To-Do — {formatDate(new Date())}</h1>
        <span
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm ${
            data.total === 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          {data.total === 0 ? "All clear ✓" : `${data.total} pending`}
        </span>
      </div>
      <p className="text-sm text-slate-600">
        This list rebuilds itself every morning — items stay here until handled.
      </p>

      {/* Owner: add items for the supervisors */}
      {owner && (
        <form
          action={addOwnerTodo}
          className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-2"
        >
          <input
            name="message"
            required
            placeholder="Add an item for the supervisors… (e.g. dispatch problem, reminder)"
            className="flex-1 min-w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <select name="unitId" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code}
              </option>
            ))}
          </select>
          <SearchSelect
            name="jobId"
            small
            className="w-44"
            placeholder="Link a job (optional)"
            options={ownerPickJobs.map((j) => ({ value: j.id, label: jobLabel(j) }))}
          />
          <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5 text-sm font-medium">
            + Add
          </button>
        </form>
      )}

      {data.total === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center text-green-800 font-medium">
          ✅ Nothing pending. All reminders handled.
        </div>
      )}

      <Section title="📌 From the owner" count={data.ownerTodos.length}>
        {data.ownerTodos.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-sm"
          >
            <TodoTick action={toggleTodoDone} itemId={t.id} />
            <span className="flex-1 min-w-0">
              {t.message}
              {t.job && (
                <span className="text-indigo-600"> · {jobLabel(t.job)}</span>
              )}
              <span className="text-xs text-slate-400">
                {" "}
                — {t.createdBy.name}, {formatDate(t.createdAt)}
                {t.unit ? ` · ${t.unit.code}` : " · all units"}
              </span>
            </span>
            {owner && (
              <form action={deleteOwnerTodo}>
                <input type="hidden" name="itemId" value={t.id} />
                <button className="text-xs text-red-600 hover:underline">✕</button>
              </form>
            )}
          </div>
        ))}
      </Section>

      <Section title="🔴 Late targets — give the reason and a new date" count={data.lateNoReason.length}>
        {data.lateNoReason.map((i) => (
          <div key={i.id} className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm space-y-1.5">
            <p>
              <b>
                {i.stage ? `${i.stage.sequence}. ${i.stage.name}` : i.description}
              </b>
              {i.job && <span className="text-slate-500"> · {jobLabel(i.job)}</span>}
              <span className="text-red-700 font-medium"> — was due {formatDate(i.targetDate)}</span>
            </p>
            <LateReasonForm itemId={i.id} workers={workerOptions} compact />
          </div>
        ))}
      </Section>

      <Section title="🌙 Clocks left running all night — check and stop" count={data.overnight.length}>
        {data.overnight.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
            <span className="flex-1 min-w-0">
              <b>{l.employee.name}</b> running since {formatDateTime(l.startedAt)} (
              <LiveDuration since={l.startedAt} />)
              {l.job && (
                <Link href={`/jobs/${l.job.id}`} className="text-blue-700 hover:underline">
                  {" "}· {jobLabel(l.job)}
                </Link>
              )}
            </span>
            <form action={stopWorker}>
              <input type="hidden" name="timeLogId" value={l.id} />
              <button className="rounded bg-red-600 text-white px-2.5 py-1 text-xs font-medium">
                Stop now
              </button>
            </form>
          </div>
        ))}
      </Section>

      <Section title="🚚 When are these dispatches planned?" count={data.noDispatchDate.length}>
        {data.noDispatchDate.map((j) => (
          <form
            key={j.id}
            action={setJobEstimatedDispatch}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-cyan-50 border border-cyan-200 px-3 py-2 text-sm"
          >
            <input type="hidden" name="jobId" value={j.id} />
            <Link href={`/jobs/${j.id}`} className="flex-1 min-w-0 font-medium hover:underline">
              {jobLabel(j)} <span className="text-slate-500 font-normal">· {j.clientName}</span>
            </Link>
            <input
              type="date"
              name="estimatedDispatch"
              required
              className="rounded border border-cyan-300 bg-white px-2 py-1 text-xs"
            />
            <button className="rounded bg-cyan-600 text-white px-2 py-1 text-xs font-medium">Set</button>
          </form>
        ))}
      </Section>

      <Section title="📐 Drawings missing — add them" count={data.missingDrawings.length}>
        {data.missingDrawings.map((j) => {
          const src = data.copySourceByName.get(j.description);
          return (
            <div key={j.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
              <Link href={`/jobs/${j.id}`} className="flex-1 min-w-0 font-medium hover:underline">
                {jobLabel(j)} <span className="text-slate-500 font-normal">· {j.clientName}</span>
              </Link>
              {src && src.id !== j.id ? (
                <form action={copyDrawings}>
                  <input type="hidden" name="fromJobId" value={src.id} />
                  <input type="hidden" name="toJobId" value={j.id} />
                  <button
                    className="rounded bg-blue-600 text-white px-2.5 py-1 text-xs font-medium"
                    title="Same job name — usually the same drawings. Confirm to copy them across."
                  >
                    Same as {jobCode(src.jobNumber)}? Copy ✓
                  </button>
                </form>
              ) : (
                <Link href={`/jobs/${j.id}`} className="text-xs text-blue-700 hover:underline">
                  Upload on job page →
                </Link>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="🧾 PO details missing — add number and value" count={data.missingPo.length}>
        {data.missingPo.map((j) => (
          <div
            key={j.id}
            className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm space-y-1.5"
          >
            <Link href={`/jobs/${j.id}`} className="block font-medium hover:underline">
              {jobLabel(j)} <span className="text-slate-500 font-normal">· {j.clientName}</span>
              {j.poAwaited && (
                <span className="ml-2 text-xs text-amber-700">
                  PO was awaited{j.poExpectedBy ? ` — due ${formatDate(j.poExpectedBy)}` : ""} · chase it
                </span>
              )}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <form action={setJobPoNumber} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="jobId" value={j.id} />
                <input
                  name="poNumber"
                  required
                  defaultValue={j.poNumber ?? ""}
                  placeholder="PO number *"
                  className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                />
                <input
                  name="poValue"
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  defaultValue={j.poValue ?? ""}
                  placeholder="PO value (no GST) ₹ *"
                  className="w-32 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                />
                <button className="rounded bg-slate-900 text-white px-2 py-1 text-xs font-medium">Save</button>
              </form>
              {/* Not every PO has arrived yet — say so and stop the daily nag */}
              <form action={markPoAwaited} className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="jobId" value={j.id} />
                <span className="text-xs text-slate-400">or</span>
                <input
                  name="poExpectedBy"
                  type="date"
                  title="When does the customer say the PO will come?"
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                />
                <button className="rounded bg-amber-100 text-amber-900 px-2 py-1 text-xs font-medium">
                  PO not received yet
                </button>
              </form>
            </div>
          </div>
        ))}
      </Section>

      {/* Waiting on the customer — a note, not a chore */}
      {data.poAwaiting.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm p-4 space-y-1">
          <h2 className="font-semibold text-sm text-slate-600">
            ⏳ PO awaited from the customer{" "}
            <span className="text-slate-400 font-normal">({data.poAwaiting.length})</span>
          </h2>
          {data.poAwaiting.map((j) => (
            <p key={j.id} className="text-sm">
              <Link href={`/jobs/${j.id}`} className="hover:underline">
                {jobLabel(j)} <span className="text-slate-500">· {j.clientName}</span>
              </Link>
              <span className="text-xs text-slate-400">
                {j.poExpectedBy
                  ? ` — expected ${formatDate(j.poExpectedBy)}`
                  : j.poAwaitedAt
                    ? ` — waiting since ${formatDate(j.poAwaitedAt)}`
                    : ""}
              </span>
            </p>
          ))}
          <p className="text-xs text-slate-400">
            These come back to the list above on their expected date (or after two weeks).
          </p>
        </section>
      )}

      <Section title="📞 Inspection calls — tests running now" count={data.inspectionTests.length}>
        {data.inspectionTests.map((t) => (
          <div key={t.id} className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-sm">
            🧪 <b>{t.name}</b>
            {t.stage && <span className="text-slate-500"> ({t.stage.name})</span>}
            {t.job && (
              <Link href={`/jobs/${t.job.id}`} className="text-blue-700 hover:underline">
                {" "}· {jobLabel(t.job)}
              </Link>
            )}
            <span className="text-sky-700"> — arrange the inspection call.</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
