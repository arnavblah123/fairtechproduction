"use client";

import { useActionState, useRef, useEffect } from "react";
import { createUser } from "@/lib/actions/users";

export function UserCreateForm({
  units,
  canCreateAdmins,
}: {
  units: { id: string; name: string }[];
  canCreateAdmins: boolean;
}) {
  const [state, action, pending] = useActionState(createUser, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state === undefined) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="bg-white rounded-xl shadow-sm p-4 space-y-3"
    >
      <p className="text-sm font-semibold">Add user</p>
      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <input name="name" required placeholder="Name *" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-40" />
        <input name="email" type="email" required placeholder="Email *" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-52" />
        <input name="password" type="password" required placeholder="Password (8+ chars) *" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-44" />
        <select name="role" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="SUPERVISOR">Supervisor</option>
          {canCreateAdmins && <option value="ADMIN">Admin</option>}
        </select>
      </div>
      <div className="flex flex-wrap gap-3 items-center text-sm">
        <span className="text-slate-500">Units:</span>
        {units.map((u) => (
          <label key={u.id} className="flex items-center gap-1.5">
            <input type="checkbox" name="unitIds" value={u.id} className="h-4 w-4" />
            {u.name}
          </label>
        ))}
        <button
          disabled={pending}
          className="ml-auto rounded-lg bg-blue-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Creating…" : "+ Create user"}
        </button>
      </div>
    </form>
  );
}
