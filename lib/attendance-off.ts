import { db } from "@/lib/db";
import { istToday } from "@/lib/overheads";

// Daily off-list: workers who were present yesterday (any clock time or a
// biometric LOGIN) but have nothing today and no leave tick. Presence uses
// the same definition as the Labour app's integration feed.

const DAY = 86400000;
const IST_MS = 5.5 * 3600e3;

export type OffList = {
  offByUnit: Map<string, { id: string; name: string; skill: string }[]>;
  onLeaveByUnit: Map<string, { id: string; name: string; markedBy: string }[]>;
};

export async function buildOffList(unitIds: string[]): Promise<OffList> {
  // Real instants of IST midnight, today and yesterday.
  const t0 = new Date(istToday().getTime() - IST_MS);
  const y0 = new Date(t0.getTime() - DAY);

  const [employees, logs, logins, leaves] = await Promise.all([
    db.employee.findMany({
      where: { active: true, primaryUnitId: { in: unitIds } },
      select: { id: true, code: true, name: true, skill: true, primaryUnitId: true },
    }),
    db.timeLog.findMany({
      where: { startedAt: { gte: y0 } },
      select: { employeeId: true, startedAt: true },
    }),
    db.attendanceEvent.findMany({
      where: { eventType: "LOGIN", occurredAt: { gte: y0 } },
      select: { employeeCode: true, occurredAt: true },
    }),
    db.leaveDay.findMany({
      where: { date: istToday() },
      select: { employeeId: true, markedBy: true },
    }),
  ]);

  const presentYesterday = new Set<string>();
  const presentToday = new Set<string>();
  const codeToId = new Map(employees.map((e) => [e.code, e.id]));
  const mark = (empId: string | undefined, at: Date) => {
    if (!empId) return;
    (at >= t0 ? presentToday : presentYesterday).add(empId);
  };
  for (const l of logs) mark(l.employeeId, l.startedAt);
  for (const l of logins) mark(codeToId.get(l.employeeCode), l.occurredAt);

  const leaveById = new Map(leaves.map((l) => [l.employeeId, l.markedBy]));

  const offByUnit = new Map<string, { id: string; name: string; skill: string }[]>();
  const onLeaveByUnit = new Map<string, { id: string; name: string; markedBy: string }[]>();
  for (const e of employees) {
    if (leaveById.has(e.id)) {
      const arr = onLeaveByUnit.get(e.primaryUnitId) ?? [];
      arr.push({ id: e.id, name: e.name, markedBy: leaveById.get(e.id)! });
      onLeaveByUnit.set(e.primaryUnitId, arr);
      continue;
    }
    if (presentYesterday.has(e.id) && !presentToday.has(e.id)) {
      const arr = offByUnit.get(e.primaryUnitId) ?? [];
      arr.push({ id: e.id, name: e.name, skill: e.skill });
      offByUnit.set(e.primaryUnitId, arr);
    }
  }
  return { offByUnit, onLeaveByUnit };
}
