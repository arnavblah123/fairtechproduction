"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addDiscipline } from "@/lib/actions/discipline";

const FIXED: Record<string, number> = { DRINKING: 16, TIMEPASS: 8, TOBACCO: 4 };

export function DisciplineForm({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState(addDiscipline, undefined);
  const [reason, setReason] = useState("DRINKING");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === undefined) {
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
      setReason("DRINKING");
    }
  }, [state]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer text-xs font-medium text-orange-700 select-none whitespace-nowrap">
        ⚠ Discipline
      </summary>
      <form ref={formRef} action={action} className="mt-1.5 space-y-1.5 w-48">
        <input type="hidden" name="employeeId" value={employeeId} />
        {state?.error && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{state.error}</p>
        )}
        <select
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="DRINKING">Drinking — cut 16 hours</option>
          <option value="TIMEPASS">Timepass — cut 8 hours</option>
          <option value="TOBACCO">Tobacco / Cigarette — cut 4 hours</option>
          <option value="OTHER">Other…</option>
        </select>
        {reason === "OTHER" ? (
          <input
            name="hours"
            type="number"
            min={0.5}
            step={0.5}
            required
            placeholder="Hours to cut *"
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
        ) : (
          <p className="text-xs text-slate-500">
            Will cut <b>{FIXED[reason]} hours</b>.
          </p>
        )}
        <input
          name="note"
          placeholder={reason === "OTHER" ? "What happened? *" : "Note (optional)"}
          required={reason === "OTHER"}
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          disabled={pending}
          className="w-full rounded-lg bg-orange-600 text-white py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {pending ? "Recording…" : "Record hour cut"}
        </button>
      </form>
    </details>
  );
}
