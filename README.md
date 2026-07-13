# Fairtech Production Dashboard

Tracks production jobs across the three fabrication units (Chinchwad Unit-1,
Chinchwad Unit-2, Savli Unit-3). Jobs move through stages, supervisors assign
workers in real time, attendance events drive automatic time tracking, and
management gets a live overview.

**Stack:** Next.js (App Router) + TypeScript · PostgreSQL · Prisma · JWT
session cookies with role-based access. Single deployable app.

## Getting started

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and SESSION_SECRET
npx prisma migrate dev      # create the schema
npx prisma db seed          # units, demo users, templates, sample job
npm run dev                 # http://localhost:3000
```

Seeded logins (change these before real use):

| Role       | Email                        | Password       |
| ---------- | ---------------------------- | -------------- |
| Superadmin | fairtechindia@gmail.com      | fairtech@2026  |
| Admin      | admin@fairtech.local         | admin@2026     |
| Supervisor | supervisor@fairtech.local    | super@2026     |

## Roles

- **Superadmin** — everything: all units, delete jobs, promote/demote admins,
  audit trail viewer.
- **Admin** — create/edit/complete jobs, manage templates, manage employees and
  supervisors within their assigned unit(s).
- **Supervisor** — scoped to their unit(s): assign/stop workers, start/pause/
  finish/reopen stages, raise material/labour issues. No job creation, no
  client/pricing edits.
- **Workers/labourers** don't log in — they are tracked via employee records
  and the attendance integration.

A user can be assigned multiple units (people move between units).

## Key concepts

- **Job templates (process library)** — reusable ordered stage lists. Creating
  a job copies the template's stages, so later template edits never touch jobs
  already in progress. Custom stage lists can be saved as new templates during
  job creation.
- **Time logs** — every assignment creates a row (worker, job, stage, unit,
  start, end, who/what started and stopped it). This powers the "who's on what
  since when" views and is the audit basis for future reporting/payroll
  cross-checks.
- **Issues** — material/labour shortage flags raised by supervisors; shown as
  red badges on the job and dashboard, not buried in a log.
- **Job documents** — drawings and bill of material can be uploaded while
  creating a job (and added later from the job page, admins only). Files are
  stored in Postgres (up to 10 MB each) so there's no separate file-storage
  service to pay for or configure; downloads are login-protected and
  unit-scoped. If drawings grow large over time, watch database size — moving
  to object storage (e.g. Cloudflare R2's free tier) is a contained change.
- **Stage times** — each stage card shows when it was started and finished
  (with total duration), and the dashboard shows how long the current stage
  has been running.
- **Audit trail** — every state change is written to `AuditLog`, attributed to
  a user, or to `system (auto)` for attendance-driven changes.

## Attendance integration (currently stubbed)

Isolated in `lib/attendance/` — nothing else in the app knows about the vendor.

- **Webhook:** the vendor POSTs to `/api/attendance/webhook`. Until the real
  vendor format is known, the generic adapter accepts
  `{"employeeCode": "EMP001", "eventType": "LOGIN" | "LOGOUT", "occurredAt": "…"}`
  (single object or `{"events": [...]}`). Set `ATTENDANCE_WEBHOOK_SECRET` and
  the vendor must send it in the `X-Webhook-Secret` header.
- **Rules:** logout auto-closes any open time log; login auto-resumes the last
  job+stage the worker was on — unless a supervisor manually stopped or
  reassigned them in the meantime (manual always wins). Auto actions are
  audit-logged distinctly from manual ones.
- **Simulator:** the Attendance page has an admin-only simulator that runs
  events through the exact same processor, so the flow can be tested today.
- **To wire in the real vendor:** implement a `WebhookAdapter` (or
  `PollAdapter` if the vendor only offers a pull API) in
  `lib/attendance/adapters.ts` and register it. No core logic changes needed.

## Google Calendar

Two layers, both free:

1. **"Add deadline to Google Calendar" button** on every job page — opens
   Google Calendar (Android app or web) with the deadline pre-filled. Works
   with zero setup.
2. **Automatic company-calendar sync** — when configured, every job's deadline
   is pushed into a shared Google Calendar automatically on create/edit
   (all-day event + popup reminder N days before, configurable per job,
   default 7). Completing or deleting a job removes the event. Sync is
   best-effort: calendar problems never block job operations, and failures
   are recorded in the audit trail.

One-time setup for the automatic sync (~5 minutes, no cost):

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable the **Google Calendar API**.
2. Create a **service account** (IAM → Service Accounts) and download a JSON
   key for it.
3. In Google Calendar (with the fairtechindia@gmail.com account), create a
   calendar (e.g. "Fairtech Job Deadlines"), open its settings → *Share with
   specific people* → add the service account's email with **"Make changes to
   events"** permission. Then share that calendar with your team the normal
   way.
4. From the calendar's settings → *Integrate calendar*, copy the **Calendar
   ID**, and set in `.env`:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the service account's email
   - `GOOGLE_PRIVATE_KEY` — the `private_key` value from the JSON key
   - `GOOGLE_CALENDAR_ID` — the calendar ID

## Open questions (from the build spec)

1. **Attendance vendor** — deferred by decision; the isolated stub stays in
   place (webhook endpoint + simulator) until the vendor is confirmed.
2. **Calendar target** — resolved: Google Calendar (see above).
3. **Scale** — current stack comfortably handles dozens of concurrent
   supervisors/admins on a small Postgres instance.
4. **Hosting** — recommended: **Vercel (Hobby, free)** + **Neon Postgres
   (free tier)** ≈ ₹0/month to start; upgrade only if usage demands it.
   On-prem also works (any box with Node 20+ and Postgres):
   `npm run build && npm start`.

## Project layout

```
app/(app)/          protected pages (dashboard, jobs, templates, employees,
                    issues, attendance, users, audit)
app/login/          login page
app/api/attendance/ attendance webhook endpoint (stub until vendor confirmed)
lib/actions/        server actions (all mutations, permission-checked)
lib/attendance/     isolated attendance module (types, adapters, processor)
lib/                db client, sessions, permissions, audit helper,
                    Google Calendar sync (lib/google-calendar.ts)
prisma/             schema, migrations, seed
```
