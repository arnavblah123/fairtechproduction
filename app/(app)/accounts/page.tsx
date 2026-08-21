import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, isAdmin, isAccounts } from "@/lib/permissions";
import { setJobPaperwork } from "@/lib/actions/paperwork";
import { AttachmentUpload } from "@/components/attachment-upload";
import { formatDate, formatMoney, jobCode } from "@/lib/format";
import { formatFileSize } from "@/lib/attachments";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The accounts desk. One row per live job, holding only what accounts owns:
// the PO number, the PO value, the finished weight and the documents.
// Nothing about stages, workers or clocks appears here.
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; client?: string }>;
}) {
  const user = await requireUser();
  if (!isAccounts(user) && !isAdmin(user)) redirect("/");
  const canOpenJob = isAdmin(user); // accounts is kept off the shop-floor page
  const { show, client } = await searchParams;
  const onlyIncomplete = show !== "all";

  const jobs = await db.job.findMany({
    where: {
      status: { not: "COMPLETED" },
      ...(client ? { clientName: { contains: client, mode: "insensitive" } } : {}),
      // The default view is a worklist: what is still missing.
      ...(onlyIncomplete
        ? {
            OR: [
              { poNumber: null },
              { poValue: null },
              { finishedWeightKg: null },
              { attachments: { none: { kind: "DRAWING" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      buyerName: true,
      description: true,
      poNumber: true,
      poValue: true,
      poAwaited: true,
      finishedWeightKg: true,
      expectedCompletion: true,
      unit: { select: { code: true } },
      attachments: {
        select: { id: true, filename: true, size: true, kind: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ priority: "desc" }, { expectedCompletion: "asc" }],
    take: 200,
  });

  const field = "rounded-lg border border-slate-300 px-2 py-1.5 text-sm w-full";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">🧾 Accounts Desk</h1>
          <p className="text-sm text-slate-500">
            PO numbers, PO values, finished weights and drawings
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/order-book"
            className="rounded-lg bg-white border border-slate-300 px-3 py-2 text-sm font-medium"
          >
            📒 Order Book
          </Link>
          <Link
            href="/jobs/new"
            className="rounded-lg bg-amber-600 text-white px-3 py-2 text-sm font-medium"
          >
            + Book an order
          </Link>
        </div>
      </div>

      <form className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Client</span>
          <input
            name="client"
            defaultValue={client ?? ""}
            placeholder="Search client…"
            className="rounded-lg border border-slate-300 px-3 py-1.5"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-slate-500 mb-1">Show</span>
          <select
            name="show"
            defaultValue={show ?? "missing"}
            className="rounded-lg border border-slate-300 px-3 py-1.5"
          >
            <option value="missing">Only jobs missing paperwork</option>
            <option value="all">All live jobs</option>
          </select>
        </label>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Filter</button>
      </form>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-6 text-center space-y-2">
          <p className="text-3xl">✅</p>
          <h2 className="font-semibold">Nothing outstanding</h2>
          <p className="text-sm text-slate-600">
            Every live job has its PO number, PO value, weight and drawing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const drawings = job.attachments.filter((a) => a.kind === "DRAWING");
            const missing = [
              !job.poNumber && "PO number",
              job.poValue === null && !job.poAwaited && "PO value",
              job.finishedWeightKg === null && "weight",
              drawings.length === 0 && "drawing",
            ].filter(Boolean) as string[];
            return (
              <section key={job.id} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {canOpenJob ? (
                      <Link href={`/jobs/${job.id}`} className="font-semibold hover:underline">
                        {job.description}
                      </Link>
                    ) : (
                      <span className="font-semibold">{job.description}</span>
                    )}
                    <p className="text-xs text-slate-500">
                      {jobCode(job.jobNumber)} · {job.clientName}
                      {job.buyerName && <> · for {job.buyerName}</>} · {job.unit.code} · due{" "}
                      {formatDate(job.expectedCompletion)}
                    </p>
                  </div>
                  {missing.length > 0 ? (
                    <span className="text-xs font-medium text-amber-800 bg-amber-50 rounded-full px-2.5 py-1">
                      missing {missing.join(", ")}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-green-800 bg-green-50 rounded-full px-2.5 py-1">
                      complete
                    </span>
                  )}
                </div>

                <form
                  action={setJobPaperwork}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] items-end"
                >
                  <input type="hidden" name="jobId" value={job.id} />
                  <label className="text-xs text-slate-500">
                    PO number
                    <input
                      name="poNumber"
                      defaultValue={job.poNumber ?? ""}
                      placeholder="PO / reference"
                      className={field}
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    PO value ₹ (without GST)
                    <input
                      name="poValue"
                      type="number"
                      min={1}
                      step="0.01"
                      defaultValue={job.poValue ?? ""}
                      placeholder={job.poAwaited ? "PO awaited" : "e.g. 450000"}
                      className={field}
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    Finished weight (kg)
                    <input
                      name="finishedWeightKg"
                      type="number"
                      min={1}
                      step="any"
                      defaultValue={job.finishedWeightKg ?? ""}
                      placeholder="e.g. 4500"
                      className={field}
                    />
                  </label>
                  <button className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium">
                    Save
                  </button>
                </form>
                {job.poValue !== null && (
                  <p className="text-xs text-slate-500">
                    Booked at {formatMoney(job.poValue)}
                  </p>
                )}

                <details>
                  <summary className="cursor-pointer text-sm font-medium text-blue-700 select-none">
                    📐 Documents ({job.attachments.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {job.attachments.length > 0 && (
                      <ul className="space-y-0.5">
                        {job.attachments.map((a) => (
                          <li key={a.id}>
                            <a
                              href={`/api/attachments/${a.id}`}
                              className="text-xs text-blue-700 hover:underline break-all"
                            >
                              {a.kind === "BOM" ? "📄" : "📐"} {a.filename}
                              <span className="text-slate-400"> ({formatFileSize(a.size)})</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <AttachmentUpload jobId={job.id} />
                  </div>
                </details>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
