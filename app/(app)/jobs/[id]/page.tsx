import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, canAccessUnit, isAdmin } from "@/lib/permissions";
import { setJobStatus, deleteJob } from "@/lib/actions/jobs";
import { setStageStatus, assignWorker, stopWorker, addStage, recordRework } from "@/lib/actions/stages";
import { raiseIssue, resolveIssue } from "@/lib/actions/issues";
import {
  JobStatusBadge,
  StageStatusBadge,
  IssueBadge,
  PriorityBadge,
} from "@/components/badges";
import { LiveDuration } from "@/components/live-duration";
import { formatDate, formatDateTime, formatDuration, jobCode } from "@/lib/format";
import { googleCalendarLink, isCalendarConfigured } from "@/lib/google-calendar";
import { AttachmentUpload } from "@/components/attachment-upload";
import { QuickAddEmployee } from "@/components/quick-add-employee";
import { deleteAttachment } from "@/lib/actions/attachments";
import { ATTACHMENT_KIND_LABELS, formatFileSize } from "@/lib/attachments";

export const dynamic = "force-dynamic";

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const job = await db.job.findUnique({
    where: { id },
    include: {
      unit: true,
      template: true,
      createdBy: true,
      stages: {
        orderBy: { sequence: "asc" },
        include: {
          timeLogs: {
            where: { endedAt: null },
            include: { employee: true },
          },
          reworks: {
            orderBy: { createdAt: "desc" },
            include: { raisedBy: { select: { name: true } } },
          },
        },
      },
      issues: {
        orderBy: { createdAt: "desc" },
        include: { raisedBy: true, resolvedBy: true },
      },
      attachments: {
        orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          filename: true,
          mimeType: true,
          size: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      },
      timeLogs: {
        orderBy: { startedAt: "desc" },
        take: 50,
        include: { employee: true, stage: true, startedBy: true, endedBy: true },
      },
    },
  });
  if (!job || !canAccessUnit(user, job.unitId)) notFound();

  // Workers available for assignment: the pool is shared — any active worker
  // from any unit can be put on this job. Grouped with this job's unit first.
  const employees = await db.employee.findMany({
    where: { active: true },
    include: { primaryUnit: true },
    orderBy: { name: "asc" },
  });
  const workerGroups = [
    { label: `${job.unit.name} (this unit)`, list: employees.filter((e) => e.primaryUnitId === job.unitId) },
    ...[...new Set(employees.filter((e) => e.primaryUnitId !== job.unitId).map((e) => e.primaryUnit.name))].map(
      (unitName) => ({
        label: unitName,
        list: employees.filter((e) => e.primaryUnit.name === unitName),
      })
    ),
  ].filter((g) => g.list.length > 0);

  const openIssues = job.issues.filter((i) => i.status === "OPEN");
  const totalReworks = job.stages.reduce((n, s) => n + s.reworks.length, 0);
  const admin = isAdmin(user);

  // Live idle indicator: in progress but nobody clocked on right now.
  const openLogCount = job.stages.reduce((n, s) => n + s.timeLogs.length, 0);
  const isIdle = job.status === "IN_PROGRESS" && openLogCount === 0;
  const idleSince = isIdle
    ? job.timeLogs.find((l) => l.endedAt)?.endedAt ??
      job.stages.find((s) => s.status === "ACTIVE")?.startedAt ??
      job.updatedAt
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{job.clientName}</h1>
              <span className="text-slate-400">{jobCode(job.jobNumber)}</span>
              <JobStatusBadge status={job.status} />
              {job.priority && <PriorityBadge />}
              {openIssues.length > 0 && <IssueBadge count={openIssues.length} />}
              {totalReworks > 0 && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-purple-100 text-purple-800">
                  {totalReworks} rework{totalReworks === 1 ? "" : "s"}
                </span>
              )}
              {idleSince && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-800">
                  Nobody working — idle <LiveDuration since={idleSince} />
                </span>
              )}
            </div>
            <p className="text-slate-600 mt-1">{job.description}</p>
            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Unit</dt>
                <dd>{job.unit.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Due</dt>
                <dd className="font-medium">{formatDate(job.expectedCompletion)}</dd>
              </div>
              {job.buyerName && (
                <div>
                  <dt className="text-xs text-slate-400">Buyer</dt>
                  <dd>{job.buyerName}</dd>
                </div>
              )}
              {job.poNumber && (
                <div>
                  <dt className="text-xs text-slate-400">PO ref</dt>
                  <dd>{job.poNumber}</dd>
                </div>
              )}
              {job.template && (
                <div>
                  <dt className="text-xs text-slate-400">Template</dt>
                  <dd>{job.template.name}</dd>
                </div>
              )}
            </dl>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <a
                href={googleCalendarLink({
                  jobNumber: job.jobNumber,
                  clientName: job.clientName,
                  description: job.description,
                  expectedCompletion: job.expectedCompletion,
                  unitName: job.unit.name,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                📅 Add deadline to Google Calendar
              </a>
              {isCalendarConfigured() && (
                <span
                  className={`text-xs ${
                    job.googleEventId ? "text-green-700" : "text-slate-400"
                  }`}
                >
                  {job.googleEventId
                    ? "✓ Synced to company calendar"
                    : "Not yet synced to company calendar"}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {job.status === "IN_PROGRESS" && (
              <form action={setJobStatus}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="status" value="ON_HOLD" />
                <button className={`${btn} bg-amber-100 text-amber-800 hover:bg-amber-200`}>
                  Put On Hold
                </button>
              </form>
            )}
            {job.status === "ON_HOLD" && (
              <form action={setJobStatus}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="status" value="IN_PROGRESS" />
                <button className={`${btn} bg-blue-100 text-blue-800 hover:bg-blue-200`}>
                  Resume
                </button>
              </form>
            )}
            {admin && job.status !== "COMPLETED" && (
              <form action={setJobStatus}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="status" value="COMPLETED" />
                <button className={`${btn} bg-green-100 text-green-800 hover:bg-green-200`}>
                  Mark Completed
                </button>
              </form>
            )}
            {admin && (
              <Link href={`/jobs/${job.id}/edit`} className={`${btn} bg-slate-100 hover:bg-slate-200`}>
                Edit
              </Link>
            )}
            {user.role === "SUPERADMIN" && (
              <form action={deleteJob}>
                <input type="hidden" name="jobId" value={job.id} />
                <button className={`${btn} bg-red-50 text-red-700 hover:bg-red-100`}>
                  Delete
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Documents: drawings & bill of material */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Documents</h2>
        {job.attachments.length === 0 && (
          <p className="text-sm text-slate-400 mb-3">
            No drawings or BOM uploaded yet.
          </p>
        )}
        <ul className="space-y-1.5 mb-4">
          {job.attachments.map((att) => (
            <li
              key={att.id}
              className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm"
            >
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800 whitespace-nowrap">
                {ATTACHMENT_KIND_LABELS[att.kind]}
              </span>
              <a
                href={`/api/attachments/${att.id}`}
                className="font-medium text-blue-700 hover:underline break-all"
              >
                {att.filename}
              </a>
              <span className="text-xs text-slate-400">
                {formatFileSize(att.size)} · {att.uploadedBy.name} ·{" "}
                {formatDateTime(att.createdAt)}
              </span>
              {admin && (
                <form action={deleteAttachment} className="ml-auto">
                  <input type="hidden" name="attachmentId" value={att.id} />
                  <button className="text-xs text-red-600 hover:underline">
                    Delete
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {admin && <AttachmentUpload jobId={job.id} />}
      </section>

      {/* Issues */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Issues</h2>
        {openIssues.length === 0 && (
          <p className="text-sm text-slate-400 mb-3">No open issues.</p>
        )}
        <ul className="space-y-2 mb-4">
          {job.issues.map((issue) => (
            <li
              key={issue.id}
              className={`rounded-lg px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2 ${
                issue.status === "OPEN" ? "bg-red-50" : "bg-slate-50 text-slate-500"
              }`}
            >
              <div>
                <IssueBadge type={issue.type} />
                <span className="ml-2">{issue.description}</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  Raised by {issue.raisedBy.name} · {formatDateTime(issue.createdAt)}
                  {issue.status === "RESOLVED" &&
                    ` · Resolved by ${issue.resolvedBy?.name ?? "—"}`}
                </p>
              </div>
              {issue.status === "OPEN" && (
                <form action={resolveIssue}>
                  <input type="hidden" name="issueId" value={issue.id} />
                  <button className={`${btn} bg-green-100 text-green-800 hover:bg-green-200`}>
                    Resolve
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {/* One-tap raise issue */}
        <form action={raiseIssue} className="flex flex-wrap gap-2 items-center">
          <input type="hidden" name="jobId" value={job.id} />
          <select name="type" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="MATERIAL_SHORTAGE">Material Shortage</option>
            <option value="LABOUR_SHORTAGE">Labour Shortage</option>
            <option value="OTHER">Other</option>
          </select>
          <input
            name="description"
            required
            placeholder="What's the problem?"
            className="flex-1 min-w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
            🚩 Raise Issue
          </button>
        </form>
      </section>

      {/* Stage board */}
      <section>
        <h2 className="font-semibold mb-2 px-1">Stage Board</h2>
        {job.status !== "COMPLETED" && (
          <details className="mb-2">
            <summary className="cursor-pointer text-sm text-blue-700 font-medium px-1 py-1 select-none">
              + New worker not in the list? Add here
            </summary>
            <div className="mt-1">
              <QuickAddEmployee
                units={[{ id: job.unit.id, name: job.unit.name }]}
                alsoRevalidate={`/jobs/${job.id}`}
              />
            </div>
          </details>
        )}
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
          {job.stages.map((stage) => (
            <div
              key={stage.id}
              className={`w-72 shrink-0 snap-start rounded-xl shadow-sm p-3 space-y-3 ${
                stage.status === "ACTIVE"
                  ? "bg-blue-50 ring-2 ring-blue-200"
                  : stage.status === "DONE"
                  ? "bg-green-50"
                  : "bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">
                  <span className="text-slate-400 text-sm mr-1">{stage.sequence}.</span>
                  {stage.name}
                </p>
                <StageStatusBadge status={stage.status} />
              </div>

              {/* Start / end time of this stage */}
              {stage.startedAt && (
                <p className="text-xs text-slate-500 leading-snug">
                  Started {formatDateTime(stage.startedAt)}
                  {stage.completedAt ? (
                    <>
                      <br />
                      Finished {formatDateTime(stage.completedAt)} (
                      {formatDuration(stage.startedAt, stage.completedAt)})
                    </>
                  ) : (
                    stage.status === "ACTIVE" && (
                      <>
                        {" · running "}
                        <LiveDuration since={stage.startedAt} />
                      </>
                    )
                  )}
                </p>
              )}

              {/* Workers on this stage */}
              {stage.timeLogs.length > 0 && (
                <ul className="space-y-1">
                  {stage.timeLogs.map((log) => (
                    <li
                      key={log.id}
                      className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 text-sm shadow-sm"
                    >
                      <span>
                        {log.employee.name}
                        <span className="text-xs text-slate-400 ml-1">
                          <LiveDuration since={log.startedAt} />
                        </span>
                      </span>
                      <form action={stopWorker}>
                        <input type="hidden" name="timeLogId" value={log.id} />
                        <button
                          className="text-xs font-medium text-red-600 rounded-lg px-2.5 py-1.5 hover:bg-red-50 active:bg-red-100"
                          title="Stop this worker's clock"
                        >
                          Stop
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {/* One-tap assign */}
              {job.status !== "COMPLETED" && (
                <form action={assignWorker} className="flex gap-1">
                  <input type="hidden" name="stageId" value={stage.id} />
                  <select
                    name="employeeId"
                    required
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm min-w-0"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Assign worker…
                    </option>
                    {workerGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.list.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} ({e.skill})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button className="rounded-lg bg-blue-600 text-white px-3.5 py-1.5 text-sm active:bg-blue-700">
                    ➜
                  </button>
                </form>
              )}

              {/* Stage status controls */}
              <div className="flex flex-wrap gap-1.5">
                {(stage.status === "PENDING" || stage.status === "PAUSED") &&
                  job.status !== "COMPLETED" && (
                  <form action={setStageStatus}>
                    <input type="hidden" name="stageId" value={stage.id} />
                    <input type="hidden" name="status" value="ACTIVE" />
                    <button className="rounded-lg px-3 py-1.5 text-sm font-medium bg-blue-600 text-white active:bg-blue-700">
                      {stage.status === "PAUSED" ? "Resume" : "Start"}
                    </button>
                  </form>
                )}
                {stage.status === "ACTIVE" && (
                  <>
                    <form action={setStageStatus}>
                      <input type="hidden" name="stageId" value={stage.id} />
                      <input type="hidden" name="status" value="PAUSED" />
                      <button className="rounded-lg px-3 py-1.5 text-sm font-medium bg-amber-500 text-white active:bg-amber-600">
                        Pause
                      </button>
                    </form>
                    <form action={setStageStatus}>
                      <input type="hidden" name="stageId" value={stage.id} />
                      <input type="hidden" name="status" value="DONE" />
                      <button className="rounded-lg px-3 py-1.5 text-sm font-medium bg-green-600 text-white active:bg-green-700">
                        Done
                      </button>
                    </form>
                  </>
                )}
              </div>

              {/* Rework: reason is compulsory; on a Done stage it also reopens */}
              {stage.status !== "PENDING" && job.status !== "COMPLETED" && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-purple-700 select-none">
                    🔁 Rework{stage.status === "DONE" ? " (reopens stage)" : ""}
                  </summary>
                  <form action={recordRework} className="mt-1.5 space-y-1.5">
                    <input type="hidden" name="stageId" value={stage.id} />
                    <textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Reason for rework (compulsory)"
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                    <button className="rounded-lg px-3 py-1.5 text-sm font-medium bg-purple-600 text-white active:bg-purple-700">
                      Record rework
                    </button>
                  </form>
                </details>
              )}

              {/* Rework history on this stage */}
              {stage.reworks.length > 0 && (
                <ul className="space-y-1">
                  {stage.reworks.map((rw) => (
                    <li
                      key={rw.id}
                      className="text-xs bg-purple-50 text-purple-900 rounded-lg px-2 py-1.5"
                    >
                      🔁 {rw.reason}
                      <span className="text-purple-400">
                        {" "}— {rw.raisedBy.name}, {formatDateTime(rw.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {/* Add extra stage */}
          {admin && job.status !== "COMPLETED" && (
            <form
              action={addStage}
              className="w-72 shrink-0 rounded-xl border-2 border-dashed border-slate-300 p-3 flex flex-col gap-2 justify-center"
            >
              <input type="hidden" name="jobId" value={job.id} />
              <input
                name="name"
                required
                placeholder="Extra stage name"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button className="rounded-lg bg-slate-900 text-white py-1.5 text-sm">
                + Add stage
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Time log */}
      <section className="bg-white rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">Time Log (latest 50)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-2 py-2">Worker</th>
                <th className="px-2 py-2">Stage</th>
                <th className="px-2 py-2">Start</th>
                <th className="px-2 py-2">End</th>
                <th className="px-2 py-2">Duration</th>
                <th className="px-2 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {job.timeLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-2 py-2 whitespace-nowrap">{log.employee.name}</td>
                  <td className="px-2 py-2">{log.stage.name}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{formatDateTime(log.startedAt)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {log.endedAt ? (
                      formatDateTime(log.endedAt)
                    ) : (
                      <span className="text-blue-700 font-medium">active</span>
                    )}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {log.endedAt ? formatDuration(log.startedAt, log.endedAt) : (
                      <LiveDuration since={log.startedAt} />
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">
                    {log.startSource === "AUTO_ATTENDANCE"
                      ? "auto-resume"
                      : `by ${log.startedBy?.name ?? "—"}`}
                    {log.endedAt &&
                      (log.endSource === "AUTO_ATTENDANCE"
                        ? " / auto-logout"
                        : ` / ${log.endedBy?.name ?? "manual"}`)}
                  </td>
                </tr>
              ))}
              {job.timeLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-slate-400">
                    No time logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
