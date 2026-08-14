import { db } from "@/lib/db";

// Issue alerts used to go to Jagdish and the owner on WhatsApp (with an email
// fallback). That channel is retired: issues now flow through the integration
// export into the Fairtech Purchase app, where the purchase desk sees material
// shortages against the job, unit-wise, and acts on them there. No WhatsApp,
// no calls, no email — kept as a no-op so callers stay unchanged, and so the
// issue id remains a valid hook if an alert channel is ever wanted again.

export async function sendIssueAlert(issueId: string): Promise<void> {
  try {
    // Touch nothing, send nothing. The purchase app polls the export and
    // shows OPEN issues within its sync interval.
    void issueId;
    void db;
  } catch (err) {
    console.error("issue alert failed:", err);
  }
}
