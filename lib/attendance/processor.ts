import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { NormalizedAttendanceEvent } from "./types";

// Core attendance rules (see spec §3):
//
// LOGOUT → auto-close every open time log for that employee, endSource =
//          AUTO_ATTENDANCE. The stage/job stays as-is.
//
// LOGIN  → auto-resume: if the employee's most recent time log was closed by
//          the attendance system (i.e. they walked out mid-work), reopen a new
//          log on the same job + stage — unless a supervisor manually
//          reassigned or stopped them in the meantime (manual always wins):
//            - latest log still open           → supervisor already put them
//                                                somewhere; do nothing
//            - latest log ended MANUAL         → supervisor deliberately
//                                                stopped them; do nothing
//            - latest log ended AUTO           → resume, if the stage is still
//                                                ACTIVE and job not completed
//
// Every event is stored in AttendanceEvent with the processing outcome, and
// every auto start/stop is written to the audit log with userId = null so
// automatic actions are clearly distinguishable from manual ones.

export async function processAttendanceEvent(
  event: NormalizedAttendanceEvent
): Promise<string> {
  const record = await db.attendanceEvent.create({
    data: {
      employeeCode: event.employeeCode,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      raw: event.raw === undefined ? undefined : JSON.parse(JSON.stringify(event.raw)),
    },
  });

  let result: string;
  try {
    result =
      event.eventType === "LOGOUT"
        ? await handleLogout(event)
        : await handleLogin(event);
  } catch (err) {
    result = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  await db.attendanceEvent.update({
    where: { id: record.id },
    data: { processedAt: new Date(), result },
  });
  return result;
}

async function handleLogout(event: NormalizedAttendanceEvent): Promise<string> {
  const employee = await db.employee.findUnique({
    where: { code: event.employeeCode },
  });
  if (!employee) return `Unknown employee code "${event.employeeCode}"`;

  const openLogs = await db.timeLog.findMany({
    where: { employeeId: employee.id, endedAt: null },
  });
  if (openLogs.length === 0) return "No active work to close";

  for (const log of openLogs) {
    await db.timeLog.update({
      where: { id: log.id },
      data: { endedAt: event.occurredAt, endSource: "AUTO_ATTENDANCE" },
    });
    await audit(null, "timelog.autoClose", "TimeLog", log.id, {
      employeeId: employee.id,
      employeeCode: employee.code,
      stageId: log.stageId,
      jobId: log.jobId,
      reason: "attendance logout",
    });
  }
  return `Auto-closed ${openLogs.length} active time log(s)`;
}

async function handleLogin(event: NormalizedAttendanceEvent): Promise<string> {
  const employee = await db.employee.findUnique({
    where: { code: event.employeeCode },
  });
  if (!employee) return `Unknown employee code "${event.employeeCode}"`;

  const latest = await db.timeLog.findFirst({
    where: { employeeId: employee.id },
    orderBy: { startedAt: "desc" },
    include: { stage: true, job: true },
  });

  if (!latest) return "No previous work; nothing to resume";
  if (!latest.endedAt) return "Already has an active assignment; nothing to do";
  if (latest.endSource !== "AUTO_ATTENDANCE")
    return "Last assignment was ended manually by a supervisor; not resuming";
  if (latest.stage.status !== "ACTIVE")
    return `Previous stage "${latest.stage.name}" is no longer active; not resuming`;
  if (latest.job.status === "COMPLETED" || latest.job.status === "ON_HOLD")
    return `Job is ${latest.job.status.toLowerCase().replace("_", " ")}; not resuming`;

  const newLog = await db.timeLog.create({
    data: {
      employeeId: employee.id,
      jobId: latest.jobId,
      stageId: latest.stageId,
      unitId: latest.unitId,
      startedAt: event.occurredAt,
      startSource: "AUTO_ATTENDANCE",
    },
  });
  await audit(null, "timelog.autoResume", "TimeLog", newLog.id, {
    employeeId: employee.id,
    employeeCode: employee.code,
    stageId: latest.stageId,
    jobId: latest.jobId,
    reason: "attendance login",
  });
  return `Auto-resumed on "${latest.stage.name}" (${latest.job.clientName})`;
}
