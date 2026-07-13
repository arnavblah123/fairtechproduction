"use client";

import { useActionState, useRef, useEffect } from "react";
import { changePassword } from "@/lib/actions/account";

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-base";
const labelCls = "block text-sm font-medium mb-1";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="bg-white rounded-xl shadow p-6 space-y-4">
      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
          Password changed.
        </p>
      )}
      <div>
        <label className={labelCls}>Current password</label>
        <input name="current" type="password" required autoComplete="current-password" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>New password (8+ characters)</label>
        <input name="next" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Confirm new password</label>
        <input name="confirm" type="password" required autoComplete="new-password" className={inputCls} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
