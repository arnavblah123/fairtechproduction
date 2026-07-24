"use client";

import { useState } from "react";
import { addPlanItem } from "@/lib/actions/planning";

type Props = {
  planId: string;
  jobs: {
    id: string;
    label: string;
    stages: { id: string; label: string; done: boolean }[];
  }[];
};

// Owner-only: add a target to a plan — pick a job, then one of its stages
// (or free text), and the date it must be finished by.
export function PlanItemForm({ planId, jobs }: Props) {
  const [jobId, setJobId] = useState("");
  const job = jobs.find((j) => j.id === jobId);

  return (
    <form action={addPlanItem} className="flex flex-wrap items-center gap-1.5 text-sm">
      <input type="hidden" name="planId" value={planId} />
      <select
        name="jobId"
        value={jobId}
        onChange={(e) => setJobId(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1.5 max-w-44"
      >
        <option value="">General (no job)</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.label}
          </option>
        ))}
      </select>
      {job ? (
        <select
          name="stageId"
          className="rounded-lg border border-slate-300 px-2 py-1.5 max-w-44"
          defaultValue=""
        >
          <option value="">Whole job / custom…</option>
          {job.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.done ? " ✓" : ""}
            </option>
          ))}
        </select>
      ) : null}
      <input
        name="description"
        placeholder={job ? "Custom text (optional)" : "What must get done? *"}
        className="rounded-lg border border-slate-300 px-2 py-1.5 w-44"
      />
      <input
        type="date"
        name="targetDate"
        required
        className="rounded-lg border border-slate-300 px-2 py-1.5"
        title="Must be done by"
      />
      <button className="rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm font-medium">
        + Add target
      </button>
    </form>
  );
}
