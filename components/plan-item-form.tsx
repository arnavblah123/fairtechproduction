"use client";

import { useState } from "react";
import { addPlanItem } from "@/lib/actions/planning";

type Props = {
  planId: string;
  jobs: {
    id: string;
    label: string;
    info: {
      started: string | null;
      manHours: string;
      cost: string;
      doneCount: number;
      totalCount: number;
    } | null;
    stages: {
      id: string;
      label: string;
      done: boolean;
      state: string;
      worked: string | null;
    }[];
  }[];
};

const STATE_ICON: Record<string, string> = {
  DONE: "✅",
  ACTIVE: "🔵",
  REWORK: "🟣",
  PAUSED: "⏸️",
  PENDING: "⬜",
};

// Owner-only: add a target to a plan — pick a job, then one of its stages
// (or free text), and the date it must be finished by. Picking a job also
// shows its history: stages done, time gone in, money gone in.
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

      {/* History of the selected job: what's done, time gone, money gone */}
      {job?.info && (
        <div className="w-full rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-xs space-y-1.5">
          <p className="font-semibold text-indigo-900">
            {job.info.doneCount}/{job.info.totalCount} stages done
            {job.info.started
              ? ` · working since ${job.info.started}`
              : " · no work logged yet"}
            {" "}· {job.info.manHours} man-hours · {job.info.cost} gone in
          </p>
          <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-0.5 text-indigo-900">
            {job.stages.map((s) => (
              <li key={s.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {STATE_ICON[s.state] ?? "⬜"} {s.label}
                </span>
                <span className="text-indigo-600 whitespace-nowrap">
                  {s.worked ? `⏱ ${s.worked}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-indigo-500">
            Money = labour + this job&apos;s overhead share so far. Time excludes idle gaps.
          </p>
        </div>
      )}
    </form>
  );
}
