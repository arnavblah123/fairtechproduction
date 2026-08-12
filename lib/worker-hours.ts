import { db } from "@/lib/db";

// Hours each worker actually clocked, split by IST calendar day, for one
// month. Powers the Hours column on the Employees page and the date-wise
// CSV download. An overnight shift is split across the two days it touches;
// the +4h full-night OT credit lands on the day the shift started (matching
// how all cost totals treat it).

const IST_MS = 5.5 * 3600e3;
const DAY = 86400000;

export function istMonthRange(monthStr?: string | null) {
  const nowIst = new Date(Date.now() + IST_MS);
  let y = nowIst.getUTCFullYear();
  let m = nowIst.getUTCMonth(); // 0-based
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    y = Number(monthStr.slice(0, 4));
    m = Number(monthStr.slice(5, 7)) - 1;
  }
  return {
    y,
    m,
    start: new Date(Date.UTC(y, m, 1) - IST_MS), // IST midnight, in UTC
    end: new Date(Date.UTC(y, m + 1, 1) - IST_MS),
    daysInMonth: new Date(Date.UTC(y, m + 1, 0)).getUTCDate(),
    label: `${y}-${String(m + 1).padStart(2, "0")}`,
  };
}

export type WorkerMonth = {
  id: string;
  name: string;
  code: string;
  unit: string;
  /** Minutes worked per day of the month, index 0 = the 1st. */
  days: number[];
  totalMinutes: number;
};

export async function monthlyWorkerHours(
  unitIds: string[] | null,
  monthStr?: string | null
): Promise<{ workers: WorkerMonth[]; daysInMonth: number; label: string }> {
  const { y, m, start, end, daysInMonth, label } = istMonthRange(monthStr);
  const now = new Date();

  const logs = await db.timeLog.findMany({
    where: {
      startedAt: { lt: end },
      OR: [{ endedAt: null }, { endedAt: { gt: start } }],
      ...(unitIds ? { employee: { primaryUnitId: { in: unitIds } } } : {}),
    },
    select: {
      startedAt: true,
      endedAt: true,
      otBonusMinutes: true,
      employee: {
        select: { id: true, name: true, code: true, primaryUnit: { select: { code: true } } },
      },
    },
  });

  const byWorker = new Map<string, WorkerMonth>();
  const workerFor = (e: (typeof logs)[number]["employee"]) => {
    let w = byWorker.get(e.id);
    if (!w) {
      w = {
        id: e.id,
        name: e.name,
        code: e.code,
        unit: e.primaryUnit.code,
        days: new Array(daysInMonth).fill(0),
        totalMinutes: 0,
      };
      byWorker.set(e.id, w);
    }
    return w;
  };

  for (const l of logs) {
    const s = Math.max(l.startedAt.getTime(), start.getTime());
    const e = Math.min((l.endedAt ?? now).getTime(), end.getTime(), now.getTime());
    if (e > s) {
      const w = workerFor(l.employee);
      // Walk the log day-by-day so overnight work lands on both dates.
      let cur = s;
      while (cur < e) {
        const istDayIdx = Math.floor((cur + IST_MS) / DAY);
        const dayEndUtc = (istDayIdx + 1) * DAY - IST_MS;
        const chunkEnd = Math.min(e, dayEndUtc);
        const d = new Date(istDayIdx * DAY); // UTC noonless stand-in for the IST date
        if (d.getUTCFullYear() === y && d.getUTCMonth() === m) {
          const minutes = (chunkEnd - cur) / 60000;
          w.days[d.getUTCDate() - 1] += minutes;
          w.totalMinutes += minutes;
        }
        cur = chunkEnd;
      }
    }
    // Full-night OT credit (+4h) counts on the day the shift started.
    if (l.otBonusMinutes > 0) {
      const sd = new Date(Math.floor((l.startedAt.getTime() + IST_MS) / DAY) * DAY);
      if (sd.getUTCFullYear() === y && sd.getUTCMonth() === m) {
        const w = workerFor(l.employee);
        w.days[sd.getUTCDate() - 1] += l.otBonusMinutes;
        w.totalMinutes += l.otBonusMinutes;
      }
    }
  }

  const workers = [...byWorker.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { workers, daysInMonth, label };
}

export function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}
