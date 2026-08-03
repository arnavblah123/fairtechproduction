import { db } from "@/lib/db";
import { istToday } from "@/lib/overheads";

// Daily off-list: workers who were present yesterday (any clock time or a
// biometric LOGIN) but have nothing today and no leave tick. Presence uses
// the same definition as the Labour app's integration feed.
//
// A shift that starts one evening and runs past midnight counts as present on
// both days, so presence is judged by the clock's overlap with each day — not
// by when it started. Anyone still clocked on right now is present today.

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
      // Anything that could touch yesterday or today: started since yesterday
      // midnight, ended after it, or still running from earlier.
      where: { OR: [{ startedAt: { gte: y0 } }, { endedAt: null }, { endedAt: { gte: y0 } }] },
      select: { employeeId: true, startedAt: true, endedAt: true },
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
  const now = new Date();
  // A clock counts for a day if any part of it falls inside that day.
  const overlaps = (start: Date, end: Date | null, winStart: Date, winEnd: Date) =>
    start < winEnd && (end ?? now) >= winStart;
  for (const l of logs) {
    if (overlaps(l.startedAt, l.endedAt, t0, new Date(t0.getTime() + DAY))) {
      presentToday.add(l.employeeId);
    }
    if (overlaps(l.startedAt, l.endedAt, y0, t0)) presentYesterday.add(l.employeeId);
  }
  for (const l of logins) {
    const id = codeToId.get(l.employeeCode);
    if (!id) continue;
    (l.occurredAt >= t0 ? presentToday : presentYesterday).add(id);
  }

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
