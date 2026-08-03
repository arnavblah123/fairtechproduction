// Consumable costs pulled from the Fairtech Store app (separate deploy).
// The Store exposes GET /api/integration/jobcosts keyed by a shared secret
// (its PRODUCTION_KEY = our INTEGRATION_EXPORT_KEY). Jobs are linked by
// externalRef "PRD-<jobNumber>". Owner-only figures; any failure returns an
// empty map so pages never break when the Store is unreachable.

export type ConsumableCost = {
  direct: number; // consumables issued straight to this job
  sharedAlloc: number; // share of the unit's General Shop Work pool
  overheadAlloc: number; // share of unassigned store overheads
  trueCost: number;
};

const STORE_URL =
  process.env.CONSUMABLES_URL ?? "https://fairtechconsumablesystem.vercel.app";

export async function getConsumableCosts(): Promise<Map<number, ConsumableCost>> {
  const map = new Map<number, ConsumableCost>();
  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (!key) return map;
  try {
    const res = await fetch(`${STORE_URL}/api/integration/jobcosts`, {
      headers: { "x-integration-key": key },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return map;
    const data = (await res.json()) as {
      jobs?: {
        externalRef: string;
        direct: number;
        sharedAlloc: number;
        overheadAlloc: number;
        trueCost: number;
      }[];
    };
    for (const j of data.jobs ?? []) {
      const m = /^PRD-(\d+)$/.exec(j.externalRef ?? "");
      if (!m) continue;
      const n = Number(m[1]);
      const prev = map.get(n);
      map.set(n, {
        direct: (prev?.direct ?? 0) + (j.direct || 0),
        sharedAlloc: (prev?.sharedAlloc ?? 0) + (j.sharedAlloc || 0),
        overheadAlloc: (prev?.overheadAlloc ?? 0) + (j.overheadAlloc || 0),
        trueCost: (prev?.trueCost ?? 0) + (j.trueCost || 0),
      });
    }
  } catch {
    // Store down / key mismatch / timeout — show no consumable figures.
  }
  return map;
}
