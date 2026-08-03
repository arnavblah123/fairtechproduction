import { db } from "@/lib/db";
import { overheadByJob } from "@/lib/overheads";
import { workedByStage, fmtWorked } from "@/lib/idle";
import { formatDate, formatMoney, jobCode } from "@/lib/format";
import { otOverlapMinutes } from "@/lib/ot";
import { getConsumableCosts } from "@/lib/consumables";

// Full cost breakdown of one job as an HTML email — sent to the owner when
// the job is dispatched. Per-worker hours (incl. OT) × wage, stage times,
// overhead share, grand total.
export async function buildDispatchCostEmail(
  jobId: string
): Promise<{ subject: string; html: string } | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      unit: true,
      stages: { orderBy: { sequence: "asc" } },
      timeLogs: {
        select: {
          stageId: true,
          startedAt: true,
          endedAt: true,
          otBonusMinutes: true,
          employee: { select: { id: true, name: true, hourlyWage: true } },
        },
      },
    },
  });
  if (!job) return null;

  const end = job.completedAt ?? new Date();
  const perWorker = new Map<
    string,
    { name: string; wage: number | null; minutes: number; otMinutes: number }
  >();
  for (const l of job.timeLogs) {
    const rec =
      perWorker.get(l.employee.id) ??
      { name: l.employee.name, wage: l.employee.hourlyWage, minutes: 0, otMinutes: 0 };
    rec.minutes += Math.max(0, ((l.endedAt ?? end).getTime() - l.startedAt.getTime()) / 60000);
    rec.otMinutes += otOverlapMinutes(l.startedAt, l.endedAt ?? end);
    perWorker.set(l.employee.id, rec);
  }
  const workers = [...perWorker.values()].sort(
    (a, b) => (b.wage ?? 0) * b.minutes - (a.wage ?? 0) * a.minutes
  );
  const labour = workers.reduce((s, w) => s + (w.wage ?? 0) * (w.minutes / 60), 0);
  const overheads = (await overheadByJob([jobId])).get(jobId) ?? 0;
  const consumables =
    (await getConsumableCosts()).get(job.jobNumber)?.trueCost ?? 0;
  const total = labour + overheads + consumables;
  const manMinutes = workers.reduce((s, w) => s + w.minutes, 0);
  const stageWorked = workedByStage(job.timeLogs, end);
  const started = job.timeLogs.length
    ? new Date(Math.min(...job.timeLogs.map((l) => l.startedAt.getTime())))
    : null;

  const code = jobCode(job.jobNumber);
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:left"';
  const tdR = 'style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right"';

  const workerRows = workers
    .map(
      (w) => `<tr>
        <td ${td}>${w.name}</td>
        <td ${tdR}>${(w.minutes / 60).toFixed(1)}${
        w.otMinutes > 0 ? ` (incl. ${(w.otMinutes / 60).toFixed(1)} after 10 PM)` : ""
      }</td>
        <td ${tdR}>${w.wage ?? "not set"}</td>
        <td ${tdR}><b>${
        w.wage !== null ? formatMoney(w.wage * (w.minutes / 60)) : "—"
      }</b></td>
      </tr>`
    )
    .join("");

  const stageRows = job.stages
    .map((s) => {
      const worked = stageWorked.get(s.id);
      return `<tr>
        <td ${td}>${s.sequence}. ${s.name}</td>
        <td ${td}>${s.status}</td>
        <td ${tdR}>${worked !== undefined ? fmtWorked(worked) : "—"}</td>
      </tr>`;
    })
    .join("");

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">
    <h2 style="margin-bottom:2px">🚚 Dispatched: ${job.description}</h2>
    <p style="margin-top:0;color:#475569">
      ${code} · ${job.clientName} · ${job.unit.name}<br/>
      ${started ? `Work started ${formatDate(started)} · ` : ""}Dispatched ${formatDate(end)} ·
      ${(manMinutes / 60).toFixed(1)} man-hours total
    </p>

    <table style="border-collapse:collapse;width:100%;font-size:14px;background:#f0fdf4;border-radius:8px">
      <tr>
        <td style="padding:10px;font-size:16px"><b>Total cost</b></td>
        <td style="padding:10px;font-size:18px;text-align:right"><b>${formatMoney(total)}</b></td>
      </tr>
      <tr><td style="padding:4px 10px">Labour</td><td style="padding:4px 10px;text-align:right">${formatMoney(labour)}</td></tr>
      <tr><td style="padding:4px 10px">Overheads (job's share)</td><td style="padding:4px 10px;text-align:right">${formatMoney(overheads)}</td></tr>
      ${
        consumables > 0
          ? `<tr><td style="padding:4px 10px">Consumables (from Store app)</td><td style="padding:4px 10px;text-align:right">${formatMoney(consumables)}</td></tr>`
          : ""
      }
      ${
        job.poValue
          ? `<tr><td style="padding:4px 10px">PO value (without GST)</td><td style="padding:4px 10px;text-align:right">${formatMoney(job.poValue)}</td></tr>
             <tr>
               <td style="padding:4px 10px 10px;font-size:15px"><b>Margin</b></td>
               <td style="padding:4px 10px 10px;text-align:right;font-size:15px;color:${
                 job.poValue - total >= 0 ? "#15803d" : "#b91c1c"
               }"><b>${formatMoney(job.poValue - total)} (${(
               ((job.poValue - total) / job.poValue) * 100
             ).toFixed(1)}%)</b></td>
             </tr>`
          : ""
      }
    </table>

    <h3 style="margin-bottom:4px">Labour breakdown</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr>
        <th ${td}>Worker</th><th ${tdR}>Hours</th><th ${tdR}>₹/hr</th><th ${tdR}>Cost</th>
      </tr>
      ${workerRows || `<tr><td ${td} colspan="4">No time logged.</td></tr>`}
    </table>

    <h3 style="margin-bottom:4px">Stages</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <tr><th ${td}>Stage</th><th ${td}>Status</th><th ${tdR}>Worked (excl. idle)</th></tr>
      ${stageRows}
    </table>

    <p style="color:#64748b;font-size:12px">
      Overheads = punched-in supervisor salaries, fixed costs (rent, electricity, …)
      and worker ESI/PF, day-wise shares for the days this job was worked on.
      Full details in the app's History page.
    </p>
  </div>`;

  return {
    subject: `🚚 ${code} dispatched — ${job.description} (${job.clientName}) — cost ${formatMoney(total)}`,
    html,
  };
}
