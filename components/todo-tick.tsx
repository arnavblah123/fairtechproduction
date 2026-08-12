"use client";

import { useOptimistic, useTransition } from "react";

// The morning-list checkbox. Ticks visually the instant it is tapped
// (useOptimistic), while the server action marks it done and refreshes the
// list behind it. If the action fails, the refresh restores the truth.
export function TodoTick({
  action,
  itemId,
}: {
  action: (formData: FormData) => Promise<void>;
  itemId: string;
}) {
  const [done, setDone] = useOptimistic(false);
  const [, startTransition] = useTransition();
  return (
    <button
      type="button"
      title="Mark done"
      aria-pressed={done}
      className={`h-5 w-5 rounded border-2 text-[11px] font-bold leading-none ${
        done
          ? "border-green-600 bg-green-600 text-white"
          : "border-indigo-400 bg-white"
      }`}
      onClick={() =>
        startTransition(async () => {
          setDone(true);
          const fd = new FormData();
          fd.set("itemId", itemId);
          await action(fd);
        })
      }
    >
      {done ? "✓" : ""}
    </button>
  );
}
