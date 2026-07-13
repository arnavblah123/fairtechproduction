"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateJob } from "@/lib/actions/jobs";

type Props = {
  job: {
    id: string;
    clientName: string;
    buyerName: string;
    poNumber: string;
    description: string;
    expectedCompletion: string;
    reminderDaysBefore: number;
    priority: boolean;
  };
};

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-base";
const labelCls = "block text-sm font-medium mb-1";

export function JobEditForm({ job }: Props) {
  const [state, action, pending] = useActionState(updateJob, undefined);
  return (
    <form action={action} className="bg-white rounded-xl shadow p-6 space-y-4">
      <input type="hidden" name="jobId" value={job.id} />
      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
      )}
      <div>
        <label className={labelCls}>Client name *</label>
        <input name="clientName" required defaultValue={job.clientName} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Buyer</label>
        <input name="buyerName" defaultValue={job.buyerName} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>PO number</label>
        <input name="poNumber" defaultValue={job.poNumber} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Description *</label>
        <input name="description" required defaultValue={job.description} className={inputCls} />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Expected completion *</label>
          <input
            name="expectedCompletion"
            type="date"
            required
            defaultValue={job.expectedCompletion}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Reminder days before</label>
          <input
            name="reminderDaysBefore"
            type="number"
            min={0}
            defaultValue={job.reminderDaysBefore}
            className={inputCls}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="priority" defaultChecked={job.priority} className="h-4 w-4" />
        Priority job
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <Link
          href={`/jobs/${job.id}`}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium"
        >
          Back
        </Link>
      </div>
    </form>
  );
}
