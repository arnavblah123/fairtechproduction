import { db } from "@/lib/db";
import { jobCode, formatDate } from "@/lib/format";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";
import { sendOwnerEmail } from "@/lib/email";

// Every issue raised goes straight to Jagdish and the owner on WhatsApp:
// what the issue is, which job, by when it must be resolved, and who raised
// it. Falls back to email while WhatsApp is not configured, so an alert is
// never silently dropped. Best-effort — never throws into the caller.

const TYPE_LABEL: Record<string, string> = {
  MATERIAL_SHORTAGE: "Material shortage",
  LABOUR_SHORTAGE: "Labour shortage",
  OTHER: "Issue",
};

export async function sendIssueAlert(issueId: string): Promise<void> {
  try {
    const issue = await db.issue.findUnique({
      where: { id: issueId },
      include: {
        job: { select: { jobNumber: true, description: true, clientName: true } },
        unit: { select: { name: true } },
        raisedBy: { select: { name: true } },
      },
    });
    if (!issue) return;

    const label = TYPE_LABEL[issue.type] ?? "Issue";
    const due = issue.dueAt ? formatDate(issue.dueAt) : "not set";
    const text =
      `⚠️ ${label} raised\n\n` +
      `Issue: ${issue.description}\n` +
      `Job: ${issue.job.description} (${jobCode(issue.job.jobNumber)}) — ${issue.job.clientName}\n` +
      `Unit: ${issue.unit.name}\n` +
      `Resolve by: ${due}\n` +
      `Raised by: ${issue.raisedBy.name}`;

    if (whatsappConfigured()) {
      await sendWhatsApp(text);
      return;
    }
    await sendOwnerEmail(
      `⚠️ ${label}: ${issue.job.description} (${jobCode(issue.job.jobNumber)}) — resolve by ${due}`,
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a">
         <h2 style="margin-bottom:4px">⚠️ ${label} raised</h2>
         <p style="white-space:pre-line;margin:0">${text.split("\n").slice(2).join("\n")}</p>
         <p style="color:#64748b;font-size:12px;margin-top:14px">
           Sent by email because WhatsApp is not configured yet
           (set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID).
         </p>
       </div>`
    );
  } catch (err) {
    console.error("issue alert failed:", err);
  }
}
