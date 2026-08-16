// Itemised consumable movements for one job, pulled from the Store app's
// /api/integration/jobitems endpoint (added alongside /jobcosts). Owner-only
// figures. Any failure returns an empty list plus the reason, so the job
// page never breaks when the Store is unreachable.

export type ConsumableEntry = {
  date: string; // when it was issued (ISO) — used to place it on a stage
  item: string;
  code: string;
  category: string;
  unit: string;
  qty: number; // negative = returned to stock
  value: number; // ₹ ex-GST, negative = credit from a return
  brands: string[];
};

const STORE_URL =
  process.env.CONSUMABLES_URL ?? "https://fairtechconsumablesystem.vercel.app";

export async function getConsumableItems(
  jobNumber: number
): Promise<{ entries: ConsumableEntry[]; problem: string | null }> {
  const key = process.env.INTEGRATION_EXPORT_KEY;
  if (!key) {
    return { entries: [], problem: "INTEGRATION_EXPORT_KEY is not set on this app." };
  }
  try {
    const res = await fetch(`${STORE_URL}/api/integration/jobitems`, {
      headers: { "x-integration-key": key },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 401) {
      return {
        entries: [],
        problem:
          "The Store app rejected the key — its PRODUCTION_KEY must match this app's INTEGRATION_EXPORT_KEY.",
      };
    }
    if (res.status === 404) {
      return {
        entries: [],
        problem:
          "The Store app has no item-detail endpoint yet — redeploy the Store app so /api/integration/jobitems exists.",
      };
    }
    if (!res.ok) return { entries: [], problem: `The Store app answered ${res.status}.` };
    const data = (await res.json()) as {
      jobs?: { externalRef: string; entries: ConsumableEntry[] }[];
    };
    const mine = (data.jobs ?? []).find((j) => j.externalRef === `PRD-${jobNumber}`);
    return { entries: mine?.entries ?? [], problem: null };
  } catch (e) {
    const why =
      e instanceof Error && e.name === "TimeoutError"
        ? "did not answer in time"
        : "could not be reached";
    return { entries: [], problem: `The Store app at ${STORE_URL} ${why}.` };
  }
}
