"use client";

import { useState } from "react";
import { setPlanItemLateReason } from "@/lib/actions/planning";
import { CAUSE_LABELS } from "@/lib/causes";

export type WorkerOption = { id: string; name: string; skill: string; unitCode: string };

// Explaining a late target: pick the cause, say why, give the new date.
// Choosing "Labour" also asks which workers — each one gets a complaint
// filed against them, so a repeat offender shows up over time.
export function LateReasonForm({
  itemId,
  workers,
  compact = false,
}: {
  itemId: string;
  workers: WorkerOption[];
  compact?: boolean;
}) {
  const [cause, setCause] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = q
    ? workers.filter((w) => `${w.name} ${w.skill} ${w.unitCode}`.toLowerCase().includes(q))
    : workers;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const input = "rounded border border-red-300 bg-white px-2 py-1 text-xs";

  return (
    <form action={setPlanItemLateReason} className="space-y-1.5">
      <input type="hidden" name="itemId" value={itemId} />
      {picked.map((id) => (
        <input key={id} type="hidden" name="employeeIds" value={id} />
      ))}
      <div className="flex flex-wrap gap-1.5 items-center">
        <select
          name="cause"
          required
          value={cause}
          onChange={(e) => {
            setCause(e.target.value);
            if (e.target.value !== "LABOUR") setPicked([]);
          }}
          className={input}
          style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
        >
          <option value="">What caused it? *</option>
          {Object.entries(CAUSE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="reason"
          required
          placeholder={cause === "LABOUR" ? "What did they do / not do? *" : "Why is it late? *"}
          className={`flex-1 min-w-32 ${input}`}
        />
        <input
          type="date"
          name="revisedDate"
          required
          title="New expected date *"
          className={input}
          style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
        />
        <button className="rounded bg-red-600 text-white px-2 py-1 text-xs font-medium">Save</button>
      </div>

      {cause === "LABOUR" && (
        <div className="rounded-lg border border-red-200 bg-white p-2 space-y-1.5">
          <p className="text-xs font-medium text-red-800">
            Which worker held it up? * <span className="font-normal text-slate-500">
              (this is filed as a complaint against them)
            </span>
          </p>
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {picked.map((id) => {
                const w = workers.find((x) => x.id === id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggle(id)}
                    className="rounded bg-red-100 text-red-900 px-2 py-0.5 text-xs"
                  >
                    {w?.name ?? id} ✕
                  </button>
                );
              })}
            </div>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search worker…"
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
          />
          <div className={`overflow-y-auto ${compact ? "max-h-32" : "max-h-40"} space-y-0.5`}>
            {shown.slice(0, 40).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => toggle(w.id)}
                className={`block w-full text-left rounded px-2 py-1 text-xs ${
                  picked.includes(w.id) ? "bg-red-100 text-red-900 font-medium" : "hover:bg-slate-100"
                }`}
              >
                {picked.includes(w.id) ? "✓ " : ""}
                {w.name} <span className="text-slate-400">({w.skill} · {w.unitCode})</span>
              </button>
            ))}
            {shown.length === 0 && <p className="text-xs text-slate-400 px-2 py-1">No worker matches.</p>}
          </div>
        </div>
      )}
    </form>
  );
}
