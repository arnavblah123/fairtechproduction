import { db } from "@/lib/db";
import { jobCode } from "@/lib/format";
import { istToday } from "@/lib/overheads";
import { jobAlerts } from "@/lib/job-alerts";
import { buildOffList } from "@/lib/attendance-off";

// Read-only view of the factory for the assistant and the monitoring agent.
//
// Every tool here only ever reads. There is no free-form SQL and no write
// path: the model picks a tool name and typed arguments, and this file
// decides exactly which query runs. Each call is logged to ai_tool_calls.

const DAY = 86400000;
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const dayStart = (s: string) => new Date(new Date(s).getTime() - 5.5 * 3600e3);
const hours = (min: number) => Math.round((min / 60) * 10) / 10;

export type ToolContext = {
  source: "chat" | "monitor";
  runId: string;
  userId?: string | null;
};

export const TOOLS = [
  {
    name: "list_jobs",
    description:
      "List jobs with their status, unit, client, promised date and progress. Use for questions like " +
      "'what is running', 'which jobs are late', 'what is ready to dispatch'.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "READY_TO_DISPATCH", "COMPLETED", "ACTIVE_ANY"],
          description: "ACTIVE_ANY means everything except COMPLETED. Default ACTIVE_ANY.",
        },
        unitCode: { type: "string", description: "CH1, DH2 or SV3" },
        lateOnly: { type: "boolean", description: "Only jobs past their promised date" },
        limit: { type: "number", description: "Default 40, max 100" },
      },
    },
  },
  {
    name: "get_job",
    description:
      "Full detail of one job: stages with status and hours worked, open issues, drawings, plan targets " +
      "and everything currently wrong with it. Identify the job by its number (e.g. 21 or JOB-0021).",
    input_schema: {
      type: "object" as const,
      properties: { jobNumber: { type: "number", description: "The job number" } },
      required: ["jobNumber"],
    },
  },
  {
    name: "stage_time_logs",
    description:
      "Who worked on what and for how long. Either for one job (jobNumber) or across the factory for a " +
      "date range. Returns per-worker and per-stage hours.",
    input_schema: {
      type: "object" as const,
      properties: {
        jobNumber: { type: "number" },
        fromDate: { type: "string", description: "YYYY-MM-DD (IST)" },
        toDate: { type: "string", description: "YYYY-MM-DD (IST)" },
        unitCode: { type: "string" },
      },
    },
  },
  {
    name: "attendance",
    description:
      "Attendance for a day: how many worked in each unit, who is absent today having worked yesterday, " +
      "who is on recorded leave, and any long holidays running.",
    input_schema: {
      type: "object" as const,
      properties: { date: { type: "string", description: "YYYY-MM-DD (IST). Default today." } },
    },
  },
  {
    name: "list_todos",
    description:
      "Pending to-do items and reminders across the factory: late planning targets without a reason, " +
      "clocks left running, missing PO / drawings / dispatch dates, inspection calls, owner-added items.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "list_issues",
    description: "Issues raised on jobs. Open by default, with how overdue each one is.",
    input_schema: {
      type: "object" as const,
      properties: {
        includeResolved: { type: "boolean" },
        limit: { type: "number", description: "Default 50" },
      },
    },
  },
  {
    name: "planning_status",
    description:
      "Planned targets vs what actually happened:each target's planned date, actual date, days early/late " +
      "and the reason given when late.",
    input_schema: {
      type: "object" as const,
      properties: { limit: { type: "number", description: "Default 60 most recent targets" } },
    },
  },
];

// ---------------------------------------------------------------- runner ----

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  const started = Date.now();
  try {
    const result = await execute(name, input);
    await log(ctx, name, input, true, null, Date.now() - started);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log(ctx, name, input, false, message, Date.now() - started);
    return { error: message };
  }
}

async function log(
  ctx: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
  ok: boolean,
  errorText: string | null,
  ms: number
) {
  try {
    await db.aiToolCall.create({
      data: {
        source: ctx.source,
        runId: ctx.runId,
        userId: ctx.userId ?? null,
        toolName,
        input: input as object,
        ok,
        errorText,
        ms,
      },
    });
  } catch (e) {
    console.error("could not log tool call:", e);
  }
}

async function execute(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_jobs":
      return listJobs(input);
    case "get_job":
      return getJob(Number(input.jobNumber));
    case "stage_time_logs":
      return stageTimeLogs(input);
    case "attendance":
      return attendance(String(input.date ?? "") || undefined);
    case "list_todos":
      return listTodos();
    case "list_issues":
      return listIssues(input);
    case "planning_status":
      return planningStatus(Number(input.limit ?? 60));
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

async function listJobs(input: Record<string, unknown>) {
  const status = String(input.status ?? "ACTIVE_ANY");
  const limit = Math.min(Number(input.limit ?? 40) || 40, 100);
  const unitCode = input.unitCode ? String(input.unitCode) : null;
  const jobs = await db.job.findMany({
    where: {
      ...(status === "ACTIVE_ANY"
        ? { status: { not: "COMPLETED" as const } }
        : { status: status as "IN_PROGRESS" }),
      ...(unitCode ? { unit: { code: unitCode } } : {}),
      ...(input.lateOnly ? { expectedCompletion: { lt: new Date() }, completedAt: null } : {}),
    },
    select: {
      jobNumber: true,
      description: true,
      clientName: true,
      status: true,
      expectedCompletion: true,
      completedAt: true,
      poNumber: true,
      poValue: true,
      poAwaited: true,
      finishedWeightKg: true,
      drawingPending: true,
      unit: { select: { code: true } },
      stages: { select: { status: true, name: true, sequence: true } },
    },
    orderBy: [{ priority: "desc" }, { expectedCompletion: "asc" }],
    take: limit,
  });
  return jobs.map((j) => ({
    job: jobCode(j.jobNumber),
    jobNumber: j.jobNumber,
    name: j.description,
    client: j.clientName,
    unit: j.unit.code,
    status: j.status,
    promised: istDay(j.expectedCompletion),
    daysLate:
      j.status === "COMPLETED" || !j.expectedCompletion
        ? null
        : Math.round((Date.now() - j.expectedCompletion.getTime()) / DAY),
    stagesDone: `${j.stages.filter((s) => s.status === "DONE").length}/${j.stages.length}`,
    currentStage:
      j.stages.find((s) => s.status === "ACTIVE" || s.status === "REWORK")?.name ?? null,
    poEntered: !!(j.poNumber && j.poValue),
    poAwaited: j.poAwaited,
    drawingPending: j.drawingPending,
    finishedWeightKg: j.finishedWeightKg,
  }));
}

async function getJob(jobNumber: number) {
  const job = await db.job.findUnique({
    where: { jobNumber },
    include: {
      unit: { select: { code: true, name: true } },
      stages: { orderBy: { sequence: "asc" } },
      issues: { include: { raisedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      attachments: { select: { kind: true, filename: true, createdAt: true, sourceJobId: true } },
      planItems: { include: { stage: { select: { name: true, sequence: true, completedAt: true } } } },
    },
  });
  if (!job) return { error: `No job number ${jobNumber}` };

  const logs = await db.timeLog.findMany({
    where: { jobId: job.id },
    select: { stageId: true, startedAt: true, endedAt: true, employee: { select: { name: true } } },
  });
  const now = new Date();
  const perStage = new Map<string, number>();
  const perWorker = new Map<string, number>();
  for (const l of logs) {
    const mins = Math.max(0, ((l.endedAt ?? now).getTime() - l.startedAt.getTime()) / 60000);
    if (l.stageId) perStage.set(l.stageId, (perStage.get(l.stageId) ?? 0) + mins);
    perWorker.set(l.employee.name, (perWorker.get(l.employee.name) ?? 0) + mins);
  }
  const alerts = (await jobAlerts([job.id])).get(job.id);

  return {
    job: jobCode(job.jobNumber),
    name: job.description,
    client: job.clientName,
    unit: job.unit.name,
    status: job.status,
    promised: istDay(job.expectedCompletion),
    dispatchedOn: job.completedAt ? istDay(job.completedAt) : null,
    finishedWeightKg: job.finishedWeightKg,
    poNumber: job.poNumber,
    poValue: job.poValue,
    poAwaited: job.poAwaited,
    drawingPending: job.drawingPending,
    totalManHours: hours([...perWorker.values()].reduce((a, b) => a + b, 0)),
    stages: job.stages.map((s) => ({
      seq: s.sequence,
      name: s.name,
      status: s.status,
      startedAt: s.startedAt ? istDay(s.startedAt) : null,
      completedAt: s.completedAt ? istDay(s.completedAt) : null,
      dueAt: s.dueAt ? istDay(s.dueAt) : null,
      manHours: hours(perStage.get(s.id) ?? 0),
    })),
    workers: [...perWorker.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, min]) => ({ name, manHours: hours(min) })),
    openIssues: job.issues
      .filter((i) => i.status === "OPEN")
      .map((i) => ({
        type: i.type,
        description: i.description,
        raisedBy: i.raisedBy.name,
        dueAt: i.dueAt ? istDay(i.dueAt) : null,
      })),
    drawings: job.attachments
      .filter((a) => a.kind === "DRAWING")
      .map((a) => ({ filename: a.filename, reusedFromAnotherJob: !!a.sourceJobId })),
    planTargets: job.planItems.map((p) => ({
      target: p.stage ? `${p.stage.sequence}. ${p.stage.name}` : p.description,
      plannedFor: istDay(p.revisedDate ?? p.targetDate),
      actual: p.stage?.completedAt ? istDay(p.stage.completedAt) : null,
      lateReason: p.lateReason,
    })),
    problems: alerts?.alerts.map((a) => `${a.severity}: ${a.text}`) ?? [],
  };
}

async function stageTimeLogs(input: Record<string, unknown>) {
  const jobNumber = input.jobNumber ? Number(input.jobNumber) : null;
  const from = input.fromDate ? dayStart(String(input.fromDate)) : new Date(Date.now() - 7 * DAY);
  const to = input.toDate ? new Date(dayStart(String(input.toDate)).getTime() + DAY) : new Date();
  const job = jobNumber ? await db.job.findUnique({ where: { jobNumber } }) : null;
  if (jobNumber && !job) return { error: `No job number ${jobNumber}` };

  const logs = await db.timeLog.findMany({
    where: {
      ...(job ? { jobId: job.id } : {}),
      ...(input.unitCode ? { unit: { code: String(input.unitCode) } } : {}),
      startedAt: { lt: to },
      OR: [{ endedAt: null }, { endedAt: { gt: from } }],
    },
    select: {
      startedAt: true,
      endedAt: true,
      activity: true,
      employee: { select: { name: true, skill: true } },
      stage: { select: { name: true, sequence: true } },
      job: { select: { jobNumber: true, description: true } },
      unit: { select: { code: true } },
    },
    orderBy: { startedAt: "asc" },
    take: 800,
  });
  const now = new Date();
  const rows = new Map<string, { worker: string; job: string | null; stage: string; unit: string; minutes: number; days: Set<string> }>();
  for (const l of logs) {
    const s = Math.max(l.startedAt.getTime(), from.getTime());
    const e = Math.min((l.endedAt ?? now).getTime(), to.getTime());
    if (e <= s) continue;
    const stage = l.stage ? `${l.stage.sequence}. ${l.stage.name}` : l.activity.replace(/_/g, " ").toLowerCase();
    const key = `${l.employee.name}|${l.job?.jobNumber ?? "-"}|${stage}`;
    const rec =
      rows.get(key) ??
      {
        worker: l.employee.name,
        job: l.job ? `${jobCode(l.job.jobNumber)} ${l.job.description}` : null,
        stage,
        unit: l.unit.code,
        minutes: 0,
        days: new Set<string>(),
      };
    rec.minutes += (e - s) / 60000;
    rec.days.add(istDay(new Date(s)));
    rows.set(key, rec);
  }
  return {
    from: istDay(from),
    to: istDay(new Date(to.getTime() - 1)),
    entries: [...rows.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .map((r) => ({ ...r, manHours: hours(r.minutes), days: [...r.days].length, minutes: undefined })),
  };
}

async function attendance(dateStr?: string) {
  const day = dateStr ?? istDay(new Date());
  const s = dayStart(day);
  const e = new Date(s.getTime() + DAY);
  const [logs, employees, leaves, longLeaves, units] = await Promise.all([
    db.timeLog.findMany({
      where: { startedAt: { lt: e }, OR: [{ endedAt: null }, { endedAt: { gt: s } }] },
      select: { employee: { select: { name: true, primaryUnit: { select: { code: true } } } } },
    }),
    db.employee.count({ where: { active: true } }),
    db.leaveDay.findMany({
      where: { date: new Date(day) },
      include: { employee: { select: { name: true, primaryUnit: { select: { code: true } } } } },
    }),
    db.leavePeriod.findMany({
      where: { fromDate: { lte: new Date(day) }, toDate: { gte: new Date(day) } },
      include: { employee: { select: { name: true } } },
    }),
    db.unit.findMany({ select: { id: true, code: true } }),
  ]);
  const worked = new Map<string, Set<string>>();
  for (const l of logs) {
    const u = l.employee.primaryUnit.code;
    const set = worked.get(u) ?? new Set<string>();
    set.add(l.employee.name);
    worked.set(u, set);
  }
  // Today's off-list, only meaningful for today
  const off =
    day === istDay(new Date())
      ? await buildOffList(units.map((u) => u.id))
      : null;
  const offNames: string[] = [];
  if (off) {
    for (const list of off.offByUnit.values()) offNames.push(...list.map((e) => e.name));
  }
  return {
    date: day,
    activeRoster: employees,
    workedByUnit: [...worked.entries()].map(([unit, names]) => ({
      unit,
      count: names.size,
      workers: [...names],
    })),
    totalWorked: [...worked.values()].reduce((n, s2) => n + s2.size, 0),
    absentTodayWorkedYesterday: offNames,
    markedOff: leaves.map((l) => ({
      name: l.employee.name,
      unit: l.employee.primaryUnit.code,
      reason: l.reason,
      note: l.note,
    })),
    onLongLeave: longLeaves.map((l) => ({
      name: l.employee.name,
      from: istDay(l.fromDate),
      to: istDay(l.toDate),
      reason: l.reason,
    })),
  };
}

async function listTodos() {
  const [items, jobs, plans] = await Promise.all([
    db.todoItem.findMany({
      where: { done: false },
      include: {
        job: { select: { jobNumber: true, description: true } },
        unit: { select: { code: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.job.findMany({
      where: { status: { in: ["NOT_STARTED", "IN_PROGRESS"] } },
      select: {
        jobNumber: true,
        description: true,
        poNumber: true,
        poValue: true,
        poAwaited: true,
        estimatedDispatchAt: true,
        drawingPending: true,
        status: true,
        attachments: { where: { kind: "DRAWING" }, select: { id: true }, take: 1 },
      },
    }),
    db.planItem.findMany({
      where: { done: false, lateReason: null, targetDate: { lt: new Date(Date.now() - DAY) } },
      include: {
        job: { select: { jobNumber: true, description: true } },
        stage: { select: { name: true, sequence: true, status: true } },
      },
    }),
  ]);
  return {
    ownerAdded: items.map((t) => ({
      message: t.message,
      job: t.job ? jobCode(t.job.jobNumber) : null,
      unit: t.unit?.code ?? "all units",
      addedBy: t.createdBy.name,
      addedOn: istDay(t.createdAt),
    })),
    lateTargetsWithoutReason: plans
      .filter((p) => p.stage?.status !== "DONE")
      .map((p) => ({
        job: p.job ? jobCode(p.job.jobNumber) : null,
        target: p.stage ? `${p.stage.sequence}. ${p.stage.name}` : p.description,
        wasDue: istDay(p.targetDate),
        daysLate: Math.round((Date.now() - p.targetDate.getTime()) / DAY),
      })),
    missingPo: jobs
      .filter((j) => (!j.poNumber?.trim() || !j.poValue) && !j.poAwaited)
      .map((j) => `${jobCode(j.jobNumber)} ${j.description}`),
    poAwaitedFromCustomer: jobs
      .filter((j) => j.poAwaited)
      .map((j) => `${jobCode(j.jobNumber)} ${j.description}`),
    missingDrawings: jobs
      .filter((j) => j.attachments.length === 0)
      .map((j) => `${jobCode(j.jobNumber)} ${j.description}`),
    drawingPendingConfirmation: jobs
      .filter((j) => j.drawingPending)
      .map((j) => `${jobCode(j.jobNumber)} ${j.description}`),
    noDispatchDate: jobs
      .filter((j) => j.status === "IN_PROGRESS" && !j.estimatedDispatchAt)
      .map((j) => `${jobCode(j.jobNumber)} ${j.description}`),
  };
}

async function listIssues(input: Record<string, unknown>) {
  const issues = await db.issue.findMany({
    where: input.includeResolved ? {} : { status: "OPEN" },
    include: {
      job: { select: { jobNumber: true, description: true } },
      unit: { select: { code: true } },
      raisedBy: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: Math.min(Number(input.limit ?? 50) || 50, 200),
  });
  return issues.map((i) => ({
    job: `${jobCode(i.job.jobNumber)} ${i.job.description}`,
    unit: i.unit.code,
    type: i.type,
    description: i.description,
    status: i.status,
    raisedBy: i.raisedBy.name,
    raisedOn: istDay(i.createdAt),
    dueAt: i.dueAt ? istDay(i.dueAt) : null,
    daysOverdue: i.dueAt && i.status === "OPEN"
      ? Math.max(0, Math.round((Date.now() - i.dueAt.getTime()) / DAY))
      : 0,
  }));
}

async function planningStatus(limit: number) {
  const items = await db.planItem.findMany({
    include: {
      plan: { select: { name: true, unit: { select: { code: true } } } },
      job: { select: { jobNumber: true, description: true, status: true, completedAt: true } },
      stage: { select: { name: true, sequence: true, status: true, completedAt: true } },
    },
    orderBy: { targetDate: "desc" },
    take: Math.min(limit || 60, 200),
  });
  return items.map((p) => {
    const actual = p.stage?.completedAt ?? (p.isDispatch ? p.job?.completedAt ?? null : null) ?? p.doneAt;
    const target = p.revisedDate ?? p.targetDate;
    return {
      plan: p.plan.name,
      unit: p.plan.unit?.code ?? "all",
      job: p.job ? `${jobCode(p.job.jobNumber)} ${p.job.description}` : null,
      target: p.stage ? `${p.stage.sequence}. ${p.stage.name}` : p.description,
      plannedFor: istDay(target),
      actual: actual ? istDay(actual) : null,
      daysLate: actual
        ? Math.round((actual.getTime() - target.getTime()) / DAY)
        : Math.round((Date.now() - target.getTime()) / DAY),
      done: !!actual,
      lateReason: p.lateReason,
    };
  });
}

// Small helper used by the monitor to stamp findings with the IST day.
export function istTodayDate(): Date {
  return istToday();
}
