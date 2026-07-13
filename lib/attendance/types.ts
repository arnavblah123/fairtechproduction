// ---------------------------------------------------------------------------
// Attendance integration — isolated module.
//
// The rest of the app only ever sees a `NormalizedAttendanceEvent`. When the
// real vendor (biometric system) is known, write an adapter that converts the
// vendor payload into this shape and register it in `adapters.ts`. Nothing
// outside lib/attendance/ needs to change.
//
// Two integration styles are supported:
//   1. Webhook push  → POST /api/attendance/webhook   (vendor calls us)
//   2. Scheduled poll → implement `PollAdapter.fetchEvents()` and call it from
//      a cron hitting /api/attendance/poll (stub included)
// ---------------------------------------------------------------------------

export type NormalizedAttendanceEvent = {
  employeeCode: string; // must match Employee.code
  eventType: "LOGIN" | "LOGOUT";
  occurredAt: Date;
  raw?: unknown; // original vendor payload, stored for debugging
};

// Converts one vendor webhook body into normalized events (a payload may
// contain several punches).
export interface WebhookAdapter {
  name: string;
  parse(body: unknown): NormalizedAttendanceEvent[];
}

// For vendors that only expose a pull API: fetch events since a checkpoint.
export interface PollAdapter {
  name: string;
  fetchEvents(since: Date): Promise<NormalizedAttendanceEvent[]>;
}
