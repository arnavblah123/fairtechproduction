import { z } from "zod";
import type { NormalizedAttendanceEvent, WebhookAdapter } from "./types";

// Generic adapter: accepts an already-normalized JSON payload. This is the
// stub used until the real attendance vendor's format is known. It accepts
// either a single event object or { events: [...] }.
const eventSchema = z.object({
  employeeCode: z.string().min(1),
  eventType: z.enum(["LOGIN", "LOGOUT"]),
  occurredAt: z.coerce.date().optional(),
});

const bodySchema = z.union([
  eventSchema,
  z.object({ events: z.array(eventSchema) }),
]);

export const genericAdapter: WebhookAdapter = {
  name: "generic",
  parse(body: unknown): NormalizedAttendanceEvent[] {
    const parsed = bodySchema.parse(body);
    const items = "events" in parsed ? parsed.events : [parsed];
    return items.map((e) => ({
      employeeCode: e.employeeCode,
      eventType: e.eventType,
      occurredAt: e.occurredAt ?? new Date(),
      raw: body,
    }));
  },
};

// When the real vendor is known, add its adapter here, e.g.:
//   export const essl: WebhookAdapter = { name: "essl", parse(body) {...} }
// and map it below.
const adapters: Record<string, WebhookAdapter> = {
  generic: genericAdapter,
};

export function getAdapter(name: string | null): WebhookAdapter {
  return adapters[name ?? "generic"] ?? genericAdapter;
}
