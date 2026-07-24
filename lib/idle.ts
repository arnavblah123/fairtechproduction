// Idle-time helpers.
//
// "Idle" = calendar time within a job's working span when no worker was
// clocked on the job. Note this includes nights/holidays between shifts —
// it is honest gap time, not shift-adjusted.

type LogLike = { startedAt: Date; endedAt: Date | null };

// Total minutes covered by the union of [start, end] intervals.
export function unionMinutes(intervals: { start: Date; end: Date }[]): number {
  const sorted = intervals
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  let total = 0;
  let curStart: number | null = null;
  let curEnd = 0;
  for (const { start, end } of sorted) {
    const s = start.getTime();
    const e = end.getTime();
    if (curStart === null) {
      curStart = s;
      curEnd = e;
    } else if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return total / 60000;
}

// Breakdown of a job's span: from first clock-in to `spanEnd`, how much was
// worked (any worker clocked) vs idle. Returns null when nothing was logged.
export function jobSpanBreakdown(
  logs: LogLike[],
  spanEnd: Date
): { spanStart: Date; spanMinutes: number; workedMinutes: number; idleMinutes: number } | null {
  if (logs.length === 0) return null;
  const spanStart = new Date(Math.min(...logs.map((l) => l.startedAt.getTime())));
  const spanMinutes = Math.max(0, (spanEnd.getTime() - spanStart.getTime()) / 60000);
  const workedMinutes = unionMinutes(
    logs.map((l) => ({
      start: l.startedAt,
      end: new Date(Math.min((l.endedAt ?? spanEnd).getTime(), spanEnd.getTime())),
    }))
  );
  return {
    spanStart,
    spanMinutes,
    workedMinutes,
    idleMinutes: Math.max(0, spanMinutes - workedMinutes),
  };
}

// Cumulative actively-worked time for one stage (or any set of logs): the
// union of the logs' intervals, with open logs counted up to `now`. Gaps
// where nobody was clocked on (idle) are never included, and overlapping
// workers don't double-count — 3 people for 1 hour = 1 hour of wall time.
export function workedMinutes(logs: LogLike[], now: Date = new Date()): number {
  return unionMinutes(
    logs.map((l) => ({ start: l.startedAt, end: l.endedAt ?? now }))
  );
}

// Group logs by stage and compute each stage's worked total in one pass.
export function workedByStage(
  logs: ({ stageId: string | null } & LogLike)[],
  now: Date = new Date()
): Map<string, number> {
  const byStage = new Map<string, LogLike[]>();
  for (const l of logs) {
    if (!l.stageId) continue;
    const arr = byStage.get(l.stageId);
    if (arr) arr.push(l);
    else byStage.set(l.stageId, [l]);
  }
  const out = new Map<string, number>();
  for (const [stageId, list] of byStage) out.set(stageId, workedMinutes(list, now));
  return out;
}

export function fmtWorked(minutes: number): string {
  const mins = Math.floor(minutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtIdle(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}
