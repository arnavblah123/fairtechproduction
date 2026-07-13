// ---------------------------------------------------------------------------
// Google Calendar integration.
//
// A Google service account pushes each job's expected-completion date into a
// shared company calendar (free — the Calendar API has no usage cost at this
// scale). One-time setup, documented in the README:
//   1. Create a Google Cloud project, enable the Calendar API.
//   2. Create a service account + JSON key.
//   3. Share the target Google Calendar with the service account's email
//      (permission: "Make changes to events").
//   4. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and
//      GOOGLE_CALENDAR_ID in .env.
//
// Until those are set, sync is silently skipped — job operations never fail
// because of calendar problems (sync is best-effort by design).
// ---------------------------------------------------------------------------

import { importPKCS8, SignJWT } from "jose";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jobCode } from "@/lib/format";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.GOOGLE_CALENDAR_ID
  );
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  // Keys pasted into .env usually have literal \n sequences.
  const pem = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const key = await importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

function calendarApiBase(): string {
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!);
  return `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
}

type SyncableJob = {
  id: string;
  jobNumber: number;
  clientName: string;
  description: string;
  status: string;
  expectedCompletion: Date;
  reminderDaysBefore: number;
  googleEventId: string | null;
  unit: { name: string };
};

function eventBody(job: SyncableJob) {
  const dateStr = job.expectedCompletion.toISOString().slice(0, 10);
  const nextDay = new Date(job.expectedCompletion);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  // Google caps reminder offsets at 40320 minutes (4 weeks).
  const reminderMinutes = Math.min(40320, Math.max(0, job.reminderDaysBefore) * 24 * 60);
  return {
    summary: `${jobCode(job.jobNumber)} due: ${job.clientName} — ${job.description}`,
    description: `Unit: ${job.unit.name}\nExpected completion for ${job.clientName}.\n(Managed by Fairtech Production Dashboard — edits here will be overwritten.)`,
    start: { date: dateStr },
    end: { date: nextDay.toISOString().slice(0, 10) },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: reminderMinutes }],
    },
  };
}

// Best-effort sync of one job to Google Calendar. Creates, updates, or (for
// completed jobs) removes the event. Never throws — failures are recorded in
// the audit log and job operations proceed regardless.
export async function syncJobToCalendar(jobId: string): Promise<void> {
  if (!isCalendarConfigured()) return;
  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: { unit: true },
    });
    if (!job) return;

    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Completed jobs shouldn't keep firing reminders — remove the event.
    if (job.status === "COMPLETED") {
      if (job.googleEventId) {
        await fetch(`${calendarApiBase()}/${job.googleEventId}`, {
          method: "DELETE",
          headers,
        });
        await db.job.update({ where: { id: jobId }, data: { googleEventId: null } });
        await audit(null, "calendar.eventDelete", "Job", jobId, { reason: "job completed" });
      }
      return;
    }

    if (job.googleEventId) {
      const res = await fetch(`${calendarApiBase()}/${job.googleEventId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(eventBody(job)),
      });
      if (res.ok) {
        await audit(null, "calendar.eventUpdate", "Job", jobId, { eventId: job.googleEventId });
        return;
      }
      // Event was deleted on the Google side — fall through and recreate.
      if (res.status !== 404 && res.status !== 410) {
        throw new Error(`Calendar update failed (${res.status}): ${await res.text()}`);
      }
    }

    const res = await fetch(calendarApiBase(), {
      method: "POST",
      headers,
      body: JSON.stringify(eventBody(job)),
    });
    if (!res.ok) {
      throw new Error(`Calendar insert failed (${res.status}): ${await res.text()}`);
    }
    const created = (await res.json()) as { id: string };
    await db.job.update({ where: { id: jobId }, data: { googleEventId: created.id } });
    await audit(null, "calendar.eventCreate", "Job", jobId, { eventId: created.id });
  } catch (err) {
    console.error(`Google Calendar sync failed for job ${jobId}:`, err);
    await audit(null, "calendar.syncError", "Job", jobId, {
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  }
}

// Best-effort removal, used when a job is deleted outright.
export async function deleteCalendarEvent(eventId: string, jobId: string): Promise<void> {
  if (!isCalendarConfigured()) return;
  try {
    const token = await getAccessToken();
    await fetch(`${calendarApiBase()}/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    await audit(null, "calendar.eventDelete", "Job", jobId, { reason: "job deleted" });
  } catch (err) {
    console.error(`Google Calendar event delete failed for job ${jobId}:`, err);
  }
}

// Zero-config fallback: a link that opens Google Calendar (app or web) with
// the event pre-filled, for anyone to add to their own calendar with one tap.
// Works without any service-account setup.
export function googleCalendarLink(job: {
  jobNumber: number;
  clientName: string;
  description: string;
  expectedCompletion: Date;
  unitName: string;
}): string {
  const dateStr = job.expectedCompletion.toISOString().slice(0, 10).replace(/-/g, "");
  const nextDay = new Date(job.expectedCompletion);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endStr = nextDay.toISOString().slice(0, 10).replace(/-/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${jobCode(job.jobNumber)} due: ${job.clientName} — ${job.description}`,
    dates: `${dateStr}/${endStr}`,
    details: `Unit: ${job.unitName}\nExpected completion for ${job.clientName}.`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
