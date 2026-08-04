// Consumable costs pulled from the Fairtech Store app (separate deploy).
// The Store exposes GET /api/integration/jobcosts keyed by a shared secret
// (its PRODUCTION_KEY = our INTEGRATION_EXPORT_KEY). Jobs are linked by
// externalRef "PRD-<jobNumber>". Owner-only figures; any failure returns an
// empty map so pages never break when the Store is unreachable — but the
// reason comes back with it, so the owner is never left guessing why the
// consumable line is missing.

export type ConsumableCost = {
  direct: number; // consumables issued straight to this job
  sharedAlloc: number; // share of the unit's General Shop Work pool
  overheadAlloc: number; // share of unassigned store overheads
  trueCost: number;
};

const STORE_URL =
  process.env.CONSUMABLES_URL ?? "https://fairtechconsumablesystem.vercel.app";

export type ConsumablesResult = {
  costs: Map<number, ConsumableCost>;
  /** Plain-English reason the figures are missing, or null when all is well. */
  problem: string | null;
};

export async function getConsumableCostsWithStatus(): Promise<ConsumablesResult> {
  const costs = new Map<number, ConsumableCost>();
  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (!key) {
    return { costs, problem: "INTEGRATION_EXPORT_KEY is not set on this app." };
  }
  try {
    const res = await fetch(`${STORE_URL}/api/integration/jobcosts`, {
      headers: { "x-integration-key": key },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 401) {
      return {
        costs,
        problem:
          "The Store app rejected the key — its PRODUCTION_KEY must be the same value as this app's INTEGRATION_EXPORT_KEY.",
      };
    }
    if (res.status === 404) {
      return {
        costs,
        problem: `No costing endpoint at ${STORE_URL} — check CONSUMABLES_URL points at the Store app and that it has redeployed.`,
      };
    }
    if (!res.ok) {
      return { costs, problem: `The Store app answered ${res.status}.` };
    }
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
      const prev = costs.get(n);
      costs.set(n, {
        direct: (prev?.direct ?? 0) + (j.direct || 0),
        sharedAlloc: (prev?.sharedAlloc ?? 0) + (j.sharedAlloc || 0),
        overheadAlloc: (prev?.overheadAlloc ?? 0) + (j.overheadAlloc || 0),
        trueCost: (prev?.trueCost ?? 0) + (j.trueCost || 0),
      });
    }
    if (costs.size === 0) {
      return {
        costs,
        problem:
          "The Store app has no consumables booked against a production job yet — " +
          "tap ⟳ Sync production there, then issue material against a job.",
      };
    }
    return { costs, problem: null };
  } catch (e) {
    const why =
      e instanceof Error && e.name === "TimeoutError"
        ? "did not answer in time"
        : "could not be reached";
    return { costs, problem: `The Store app at ${STORE_URL} ${why}.` };
  }
}

export async function getConsumableCosts(): Promise<Map<number, ConsumableCost>> {
  return (await getConsumableCostsWithStatus()).costs;
}
