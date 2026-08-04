// Talks to the store app (fairtechconsumablesystem) over plain HTTPS with the
// shared integration key — no third-party service, nothing to pay for.
// Set INVENTORY_URL (e.g. https://fairtech-store.vercel.app) and reuse
// INTEGRATION_EXPORT_KEY. If either is missing every helper is a no-op, so
// production keeps working on its own.

export type HeldItem = {
  useId: number;
  item: string;
  qty: number;
  unit: string;
  value: number;
  takenFor: string;
  takenAt: string;
  splitPreview: { jobId: number; hours: number; pct: number }[];
};

export type HeldByWorker = { employeeCode: string; name: string; items: HeldItem[] };

function config() {
  const base = (process.env.INVENTORY_URL || "").replace(/\/$/, "");
  const key = process.env.INTEGRATION_EXPORT_KEY;
  return base && key ? { base, key } : null;
}

export function inventoryLinked() {
  return config() !== null;
}

// What consumables are these workers still holding? Never throws — the store
// app being down must not block a supervisor from shifting someone.
export async function heldItems(employeeCodes: string[]): Promise<HeldByWorker[]> {
  const cfg = config();
  const codes = employeeCodes.filter(Boolean);
  if (!cfg || codes.length === 0) return [];
  try {
    const resp = await fetch(
      `${cfg.base}/api/integration/worker-items?employeeCode=${encodeURIComponent(codes.join(","))}`,
      { headers: { "x-integration-key": cfg.key }, cache: "no-store" },
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as { workers?: HeldByWorker[] };
    return data.workers ?? [];
  } catch {
    return [];
  }
}

// Supervisor's answer: he carries it to the next job, or he is done with it
// and this much is left (which the store app puts back into stock).
export async function handOverItem(input: {
  useId: number;
  continues: boolean;
  leftoverQty?: number;
  nextJobNumber?: number;
}) {
  const cfg = config();
  if (!cfg) return false;
  try {
    const resp = await fetch(`${cfg.base}/api/integration/use-handover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-integration-key": cfg.key },
      body: JSON.stringify(input),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
