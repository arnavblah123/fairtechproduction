import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser, unitScope, allowPurchaseHr } from "@/lib/permissions";
import { jobCode, formatDate } from "@/lib/format";
import { SearchSelect } from "@/components/search-select";
import { PrintButton } from "@/components/print-button";
import { JobCalendar } from "@/components/job-calendar";

export const dynamic = "force-dynamic";

// Same timesheet calendar that sits on the job page, with a job picker on top
// — for when you want to jump between jobs instead of opening each one.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; m?: string; stage?: string }>;
}) {
  const user = await requireUser();
  allowPurchaseHr(user);
  const { job: jobParam, m, stage } = await searchParams;

  const jobs = await db.job.findMany({
    where: unitScope(user),
    select: {
      id: true,
      jobNumber: true,
      description: true,
      clientName: true,
      status: true,
      unit: { select: { code: true } },
    },
    orderBy: { jobNumber: "desc" },
    take: 300,
  });

  const jobId = jobParam ?? jobs[0]?.id;
  const job = jobId
    ? await db.job.findUnique({
        where: { id: jobId },
        include: { unit: { select: { name: true } } },
      })
    : null;

  if (!job) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">📅 Job Timesheet Calendar</h1>
        <p className="text-slate-400">No jobs yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-xl font-bold">📅 Job Timesheet Calendar</h1>
        <PrintButton />
      </div>

      <form className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-2 text-sm print:hidden">
        <div className="min-w-64 flex-1">
          <span className="block text-xs text-slate-500 mb-0.5">Job</span>
          <SearchSelect
            name="job"
            defaultValue={job.id}
            options={jobs.map((j) => ({
              value: j.id,
              label: `${j.description} — ${j.clientName} (${jobCode(j.jobNumber)} · ${j.unit.code})${
                j.status === "COMPLETED" ? " ✓" : ""
              }`,
            }))}
          />
        </div>
        <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5">Show</button>
      </form>

      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-bold">
              {job.description}{" "}
              <span className="font-normal text-slate-400 text-sm">{jobCode(job.jobNumber)}</span>
            </p>
            <p className="text-sm text-slate-500">
              {job.clientName} · {job.unit.name} · promised {formatDate(job.expectedCompletion)}
            </p>
          </div>
          <Link href={`/jobs/${job.id}`} className="text-sm text-blue-600 hover:underline print:hidden">
            Open job →
          </Link>
        </div>
        <JobCalendar
          jobId={job.id}
          month={m}
          stageId={stage}
          basePath="/calendar"
          extraParams={{ job: job.id }}
        />
      </div>
    </div>
  );
}
