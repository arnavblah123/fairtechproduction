import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { sendOwnerEmail } from "@/lib/email";

// Daily labour-calling report, scheduled by Vercel Cron (see vercel.json)
// every evening. Aggregates the day's calling activity pushed by the labour
// app and the latest pipeline snapshot, and emails the owner.

const CALL_ACTIONS = new Set(["call_started", "call_saved_contact", "call_followup", "call_retry"]);

const OUTCOME_LABELS: Record<string, string> = {
  not_interested: "Not interested",
  call_later: "Scheduled call later",
  no_response: "Call not received",
  saved_contact: "Saved as serious contact",
  hired: "Marked hired",
  moved_to_production: "Moved to production",
  instagram_enquiry_added: "New Instagram enquiry",
  labourer_added: "Added manually",
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Today's window in IST.
  const IST_MS = 5.5 * 3600 * 1000;
  const istNow = new Date(Date.now() + IST_MS);
  const dayStart = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - IST_MS
  );
  const dateLabel = istNow.toISOString().slice(0, 10);

  const [activities, snapshotRow] = await Promise.all([
    prisma.labourActivity.findMany({
      where: { occurredAt: { gte: dayStart } },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.labourSnapshot.findUnique({ where: { id: "latest" } }),
  ]);

  const calls = activities.filter((a) => CALL_ACTIONS.has(a.action));
  const messages = activities.filter((a) => a.action === "whatsapp_sent");
  const uniqueCalled = new Set(calls.map((a) => a.subjectId)).size;

  const outcomes: Record<string, number> = {};
  for (const a of activities) {
    if (OUTCOME_LABELS[a.action]) outcomes[a.action] = (outcomes[a.action] || 0) + 1;
  }

  const savedNames = activities.filter((a) => a.action === "saved_contact").map((a) => a.subjectName);
  const hiredNames = activities.filter((a) => a.action === "hired").map((a) => a.subjectName);

  const snap = (snapshotRow?.data ?? {}) as Record<string, number | string>;
  const snapTime = snapshotRow?.updatedAt
    ? new Date(snapshotRow.updatedAt.getTime() + IST_MS).toISOString().slice(0, 16).replace("T", " ")
    : null;

  const report = {
    date: dateLabel,
    callsMade: calls.length,
    workersCalled: uniqueCalled,
    whatsappSent: messages.length,
    outcomes,
    savedNames,
    hiredNames,
    pipeline: snap,
    pipelineAsOf: snapTime,
  };

  const row = (label: string, value: unknown) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555">${label}</td><td style="padding:4px 0"><b>${value}</b></td></tr>`;

  const outcomeRows = Object.entries(outcomes)
    .map(([k, v]) => row(OUTCOME_LABELS[k] || k, v))
    .join("");

  const pipelineRows = [
    row("🔥 To call (not yet called)", snap.to_call ?? "—"),
    row("⏰ Follow-ups scheduled", snap.follow_ups ?? "—"),
    row("📵 No response", snap.no_response ?? "—"),
    row("❤️ Saved contacts", snap.saved ?? "—"),
    row("✓ Hired", snap.hired ?? "—"),
    row("❌ Not interested", snap.not_interested ?? "—"),
  ].join("");

  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px">Labour calling report — ${dateLabel}</h2>
      <p style="margin:0 0 16px;color:#777">Fairtech labour app · automatic daily summary</p>
      <h3 style="margin:16px 0 4px">Today's work</h3>
      <table style="border-collapse:collapse">
        ${row("Calls made", `${calls.length} (${uniqueCalled} workers)`)}
        ${row("WhatsApp messages sent", messages.length)}
        ${outcomeRows}
      </table>
      ${savedNames.length ? `<p><b>Saved today:</b> ${savedNames.join(", ")}</p>` : ""}
      ${hiredNames.length ? `<p><b>Hired today:</b> ${hiredNames.join(", ")}</p>` : ""}
      <h3 style="margin:16px 0 4px">Pipeline stages${snapTime ? ` <span style="font-weight:normal;color:#777;font-size:13px">(as of ${snapTime} IST)</span>` : ""}</h3>
      <table style="border-collapse:collapse">${pipelineRows}</table>
      ${activities.length === 0 ? '<p style="color:#b45309"><b>No calling activity was recorded today.</b></p>' : ""}
    </div>`;

  const emailed = await sendOwnerEmail(`Labour calling report — ${dateLabel}`, html);
  return NextResponse.json({ ok: true, emailed, report });
}
