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

## Calendar / reminders

Every job's mandatory expected-completion date is exposed as an iCal feed at
`/api/calendar` (all-day event + reminder N days before, configurable per job,
default 7). Download it or subscribe from Google Calendar / Apple Calendar /
Outlook.

**Config decision pending:** direct Google Calendar API push (events appear in
a chosen Google account automatically) is possible but needs a Google Cloud
service account and a target calendar — confirm which account/calendar to use
and it can be added without touching the rest of the app.

## Open questions (from the build spec)

1. **Attendance vendor** — which biometric system is in use, and does it push
   webhooks or only expose a pull API? The stub supports both patterns.
2. **Calendar target** — iCal feed works today; Google Calendar push needs the
   account decision above.
3. **Scale** — current stack comfortably handles dozens of concurrent
   supervisors/admins on a small Postgres instance.
4. **Hosting** — works on Vercel + managed Postgres (Neon/Supabase/RDS) or
   on-prem (any box with Node 20+ and Postgres). `npm run build && npm start`.

## Project layout

```
app/(app)/          protected pages (dashboard, jobs, templates, employees,
                    issues, attendance, users, audit)
app/login/          login page
app/api/attendance/ attendance webhook endpoint
app/api/calendar/   iCal feed
lib/actions/        server actions (all mutations, permission-checked)
lib/attendance/     isolated attendance module (types, adapters, processor)
lib/                db client, sessions, permissions, audit helper, iCal
prisma/             schema, migrations, seed
```
