"use client";

import { useState } from "react";
import { shiftWorker } from "@/lib/actions/stages";
import { SearchSelect } from "@/components/search-select";
import type { HeldItem } from "@/lib/inventory";

type JobOpt = { id: string; label: string; stages: { id: string; label: string }[] };

const DUTIES = [
  { value: "duty:MATERIAL_HANDLING", label: "🚚 Material Handling" },
  { value: "duty:DISPATCH", label: "📦 Dispatch" },
  { value: "duty:PLATE_CUTTING", label: "🔥 Plate Cutting" },
  { value: "duty:STRUCTURAL_CUTTING", label: "🔩 Structural Cutting" },
];

// One row of the "Where are you shifting these people?" popup. Two steps:
// first pick the destination (same job, another job, or a general duty),
// then — for a job — pick which of its stages. Neither? The popup's ✕
// leaves the worker stopped.
export function ShiftWorkerRow({
  employee,
  jobs,
  currentJobId,
  remaining,
  held = [],
}: {
  employee: { id: string; name: string; skill: string };
  jobs: JobOpt[];
  currentJobId: string;
  remaining: string;
  held?: HeldItem[];
}) {
  const [dest, setDest] = useState("");
  // Consumables he is still holding — one answer per item.
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const destJob = dest.startsWith("job:")
    ? jobs.find((j) => j.id === dest.slice(4))
    : undefined;

  return (
    <form
      action={shiftWorker}
      className="flex flex-wrap items-center gap-2 bg-blue-500/40 rounded-lg px-3 py-2"
    >
      <input type="hidden" name="employeeId" value={employee.id} />
      <input type="hidden" name="jobId" value={currentJobId} />
      <input type="hidden" name="remaining" value={remaining} />
      <span className="font-medium min-w-32">
        {employee.name}
        <span className="text-blue-200 text-xs font-normal"> ({employee.skill})</span>
      </span>
      <SearchSelect
        name="destination"
        required
        className="flex-1 min-w-44"
        placeholder="1. Which job / duty?"
        onValueChange={setDest}
        options={[
          ...jobs.map((j) => ({ value: `job:${j.id}`, label: j.label, group: "Jobs" })),
          ...DUTIES.map((d) => ({ ...d, group: "General duties" })),
        ]}
      />
      {destJob && (
        <SearchSelect
          key={destJob.id}
          name="target"
          required
          className="flex-1 min-w-40"
          placeholder="2. Which stage?"
          options={destJob.stages.map((s) => ({ value: `stage:${s.id}`, label: s.label }))}
        />
      )}
      {dest.startsWith("duty:") && <input type="hidden" name="target" value={dest} />}

      {/* Store app: what is he still carrying, and does it go with him?
          "Keeps it" lets the cost keep splitting across his jobs by the
          hours he logs. "Finished" settles that split and puts whatever is
          left straight back into his unit's stock. */}
      {held.map((it) => (
        <div key={it.useId} className="w-full bg-blue-700/50 rounded-lg px-3 py-2 space-y-1.5">
          <div className="text-sm">
            Still has <span className="font-semibold">{it.qty} {it.unit} {it.item}</span>
            <span className="text-blue-200"> — taken for {it.takenFor}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              name={`use:${it.useId}`}
              className="flex-1 min-w-44 rounded-lg border-0 px-2 py-1.5 text-sm text-slate-900"
              value={answers[it.useId] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [it.useId]: e.target.value }))}
            >
              <option value="">Consumable — decide later</option>
              <option value="keep">Needs it on the next job too</option>
              <option value="done">Finished with it — return the rest</option>
            </select>
            {answers[it.useId] === "done" && (
              <input
                type="number"
                step="any"
                min="0"
                max={it.qty}
                name={`left:${it.useId}`}
                placeholder={`How much is left (${it.unit})`}
                className="w-44 rounded-lg border-0 px-2 py-1.5 text-sm text-slate-900"
              />
            )}
          </div>
          {it.splitPreview.length > 0 && (
            <div className="text-xs text-blue-200">
              Cost splitting now: {it.splitPreview.map((s) => `${s.pct}% (${s.hours}h)`).join(" · ")}
            </div>
          )}
        </div>
      ))}

      <button className="rounded-lg bg-white text-blue-700 px-3 py-1.5 text-sm font-semibold">
        Shift
      </button>
    </form>
  );
}
