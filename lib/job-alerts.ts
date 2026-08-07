import { db } from "@/lib/db";
import { istToday } from "@/lib/overheads";
import { formatDate } from "@/lib/format";

// Everything wrong or pending on a job, in one list: planning targets that
// have slipped, the job's own promised date, stage due dates, open issues,
// and the paperwork the morning To-Do chases. Used for the red strip on the
// dashboard card and the "needs attention" block at the top of the job.

const DAY = 86400000;

export type JobAlert = {
  /** "late" = something has already slipped; "todo" = pending, not yet late */
  severity: "late" | "todo";
  text: string;
  /** days overdue, for sorting the worst first */
  days: number;
};

export type JobAlerts = {
  alerts: JobAlert[];
  lateCount: number;
  todoCount: number;
};

function dayDiff(a: Date, b: Date): number {
  const day = (d: Date) => new Date(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })).getTime();
  return Math.round((day(a) - day(b)) / DAY);
}

export async function jobAlerts(jobIds: string[]): Promise<Map<string, JobAlerts>> {
  const out = new Map<string, JobAlerts>();
  if (jobIds.length === 0) return out;

  const today = istToday();
  const now = new Date();
  const [jobs, planItems, openLogs] = await Promise.all([
    db.job.findMany({
      where: { id: { in: jobIds } },
      select: {
        id: true,
        status: true,
        expectedCompletion: true,
        completedAt: true,
        estimatedDispatchAt: true,
        poNumber: true,
        poValue: true,
        poAwaited: true,
        poAwaitedAt: true,
        poExpectedBy: true,
        attachments: { where: { kind: "DRAWING" }, select: { id: true }, take: 1 },
        stages: {
          select: { id: true, name: true, sequence: true, status: true, dueAt: true },
          orderBy: { sequence: "asc" },
        },
        issues: {
          where: { status: "OPEN" },
          select: { id: true, type: true, description: true, dueAt: true },
        },
        tests: {
          select: {
            id: true,
            name: true,
            stage: { select: { status: true } },
          },
        },
      },
    }),
    db.planItem.findMany({
      where: { jobId: { in: jobIds }, done: false },
      include: {
        stage: { select: { name: true, sequence: true, status: true, completedAt: true } },
        job: { select: { status: true, completedAt: true } },
      },
    }),
    db.timeLog.findMany({
      where: { jobId: { in: jobIds }, endedAt: null, startedAt: { lt: new Date(today.getTime() - 1.5 * 3600e3) } },
      select: { jobId: true, startedAt: true, employee: { select: { name: true } } },
    }),
  ]);

  const planByJob = new Map<string, typeof planItems>();
  for (const p of planItems) {
    if (!p.jobId) continue;
    planByJob.set(p.jobId, [...(planByJob.get(p.jobId) ?? []), p]);
  }
  const logsByJob = new Map<string, typeof openLogs>();
  for (const l of openLogs) {
    if (!l.jobId) continue;
    logsByJob.set(l.jobId, [...(logsByJob.get(l.jobId) ?? []), l]);
  }

  for (const job of jobs) {
    const alerts: JobAlert[] = [];
    const done = job.status === "COMPLETED";

    // 1. Planning targets that have slipped
    for (const p of planByJob.get(job.id) ?? []) {
      const finished =
        p.stage?.status === "DONE" || (p.isDispatch && p.job?.status === "COMPLETED");
      if (finished) continue;
      const target = p.revisedDate ?? p.targetDate;
      const late = dayDiff(now, target);
      const label = p.stage ? `${p.stage.sequence}. ${p.stage.name}` : p.description;
      if (late > 0) {
        alerts.push({
          severity: "late",
          days: late,
          text: `${label} — planned ${formatDate(target)}, ${late}d late${
            p.lateReason ? ` (${p.lateReason})` : " — no reason given"
          }`,
        });
      }
    }

    // 2. The job's own promised date
    if (!done) {
      const late = dayDiff(now, job.expectedCompletion);
      if (late > 0) {
        alerts.push({
          severity: "late",
          days: late,
          text: `Job is ${late}d past its promised date (${formatDate(job.expectedCompletion)})`,
        });
      }
    }

    // 3. Stage due dates
    for (const s of job.stages) {
      if (!s.dueAt || s.status === "DONE") continue;
      const late = dayDiff(now, s.dueAt);
      if (late > 0) {
        alerts.push({
          severity: "late",
          days: late,
          text: `${s.sequence}. ${s.name} — due ${formatDate(s.dueAt)}, ${late}d over`,
        });
      }
    }

    // 4. Open issues (overdue ones count as late)
    for (const i of job.issues) {
      const late = i.dueAt ? dayDiff(now, i.dueAt) : 0;
      alerts.push({
        severity: late > 0 ? "late" : "todo",
        days: late,
        text:
          `🚩 ${i.description}` +
          (i.dueAt
            ? late > 0
              ? ` — was to be resolved by ${formatDate(i.dueAt)}, ${late}d over`
              : ` — resolve by ${formatDate(i.dueAt)}`
            : ""),
      });
    }

    // 5. Clocks left running overnight
    for (const l of logsByJob.get(job.id) ?? []) {
      alerts.push({
        severity: "late",
        days: Math.max(1, Math.floor((now.getTime() - l.startedAt.getTime()) / DAY)),
        text: `${l.employee.name}'s clock has been running since ${formatDate(l.startedAt)} — check and stop it`,
      });
    }

    // 6. Paperwork the morning list chases
    if (!done) {
      if (!job.poNumber?.trim() || !job.poValue) {
        if (!job.poAwaited) {
          alerts.push({ severity: "todo", days: 0, text: "PO number and value not entered" });
        } else {
          // Marked "not received yet" — quiet until the promised date passes.
          const overdueBy = job.poExpectedBy ? dayDiff(now, job.poExpectedBy) : 0;
          const waitingDays = job.poAwaitedAt ? dayDiff(now, job.poAwaitedAt) : 0;
          if (overdueBy > 0) {
            alerts.push({
              severity: "late",
              days: overdueBy,
              text: `PO still not received — customer promised ${formatDate(job.poExpectedBy!)}, ${overdueBy}d over`,
            });
          } else if (!job.poExpectedBy && waitingDays > 14) {
            alerts.push({
              severity: "late",
              days: waitingDays,
              text: `PO still not received after ${waitingDays} days — chase the customer`,
            });
          }
        }
      }
      if (job.attachments.length === 0) {
        alerts.push({ severity: "todo", days: 0, text: "Drawings not uploaded" });
      }
      if (job.status === "IN_PROGRESS" && !job.estimatedDispatchAt) {
        alerts.push({ severity: "todo", days: 0, text: "Dispatch date not set" });
      }
      for (const t of job.tests) {
        if (t.stage && (t.stage.status === "ACTIVE" || t.stage.status === "REWORK")) {
          alerts.push({ severity: "todo", days: 0, text: `📞 ${t.name} — inspection call due` });
        }
      }
    }

    alerts.sort((a, b) =>
      a.severity === b.severity ? b.days - a.days : a.severity === "late" ? -1 : 1
    );
    out.set(job.id, {
      alerts,
      lateCount: alerts.filter((a) => a.severity === "late").length,
      todoCount: alerts.filter((a) => a.severity === "todo").length,
    });
  }
  return out;
}
