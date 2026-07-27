"use client";

import { useState } from "react";
import { shiftWorker } from "@/lib/actions/stages";
import { SearchSelect } from "@/components/search-select";

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
}: {
  employee: { id: string; name: string; skill: string };
  jobs: JobOpt[];
  currentJobId: string;
  remaining: string;
}) {
  const [dest, setDest] = useState("");
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
      <button className="rounded-lg bg-white text-blue-700 px-3 py-1.5 text-sm font-semibold">
        Shift
      </button>
    </form>
  );
}
