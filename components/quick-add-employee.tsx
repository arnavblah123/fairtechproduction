"use client";

import { useActionState, useRef, useEffect } from "react";
import { quickAddEmployee } from "@/lib/actions/employees";

// Fast 30-second add: name, skill, unit, contact. Code auto-generates.
export function QuickAddEmployee({
  units,
  alsoRevalidate,
}: {
  units: { id: string; name: string }[];
  alsoRevalidate?: string; // extra path to refresh (e.g. the job page hosting the form)
}) {
  const [state, action, pending] = useActionState(quickAddEmployee, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === undefined) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap gap-2 items-center"
    >
      {alsoRevalidate && (
        <input type="hidden" name="alsoRevalidate" value={alsoRevalidate} />
      )}
      <span className="text-sm font-semibold mr-1">Quick add:</span>
      <input
        name="name"
        required
        placeholder="Name *"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-36"
      />
      <input
        name="skill"
        required
        placeholder="Skill (welder…) *"
        list="skills"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-36"
      />
      <datalist id="skills">
        <option value="Welder" />
        <option value="Fitter" />
        <option value="Helper" />
        <option value="Grinder" />
        <option value="Painter" />
        <option value="Machinist" />
      </datalist>
      <select
        name="unitId"
        required
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      >
        {units.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <input
        name="contact"
        placeholder="Contact (optional)"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-36"
      />
      <button
        disabled={pending}
        className="rounded-lg bg-blue-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add"}
      </button>
      {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
