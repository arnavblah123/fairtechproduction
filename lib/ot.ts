// Overtime definition: any worked time after 22:00 IST, up to 06:00 the
// next morning (covers till-1-AM and full-night shifts). OT is a
// classification of clocked hours, not an addition to them.

const IST_MS = 5.5 * 3600e3;
const DAY = 86400000;
const OT_START_H = 22; // 10 PM IST
const OT_LEN_MS = 8 * 3600e3; // → 06:00 next day

// Minutes of [start, end] falling inside nightly OT windows, optionally
// clipped to [clipStart, clipEnd).
export function otOverlapMinutes(
  start: Date,
  end: Date,
  clipStart?: Date,
  clipEnd?: Date
): number {
  let s0 = start.getTime();
  let e0 = end.getTime();
  if (clipStart) s0 = Math.max(s0, clipStart.getTime());
  if (clipEnd) e0 = Math.min(e0, clipEnd.getTime());
  if (e0 <= s0) return 0;

  let total = 0;
  const firstDay = Math.floor((s0 + IST_MS) / DAY) - 1;
  const lastDay = Math.floor((e0 + IST_MS) / DAY);
  for (let d = firstDay; d <= lastDay; d++) {
    const w0 = d * DAY - IST_MS + OT_START_H * 3600e3;
    const w1 = w0 + OT_LEN_MS;
    const s = Math.max(s0, w0);
    const e = Math.min(e0, w1);
    if (e > s) total += (e - s) / 60000;
  }
  return total;
}
