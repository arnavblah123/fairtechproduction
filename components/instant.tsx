"use client";

import { useTransition } from "react";
import { useFormStatus } from "react-dom";

// Instant-feedback wrappers around server actions, so a tap registers
// immediately even while the round trip to the server is still running.
//
// ActionButton — for one-tap actions with no user input (status change,
// tick, stop). The button flips to its optimistic label the moment it is
// pressed; the server action's revalidatePath then swaps in the truth.
export function ActionButton({
  action,
  fields,
  className,
  title,
  children,
  optimistic,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  className?: string;
  title?: string;
  children: React.ReactNode;
  /** What the button shows while the change syncs — defaults to children. */
  optimistic?: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const fd = new FormData();
          for (const [k, v] of Object.entries(fields)) fd.set(k, v);
          await action(fd);
        })
      }
    >
      {pending ? (optimistic ?? children) : children}
    </button>
  );
}

// PendingSubmit — a drop-in submit button for forms that carry real inputs
// (assign worker, quality check). Shows its busy label the instant the form
// submits, without changing how the form works.
export function PendingSubmit({
  className,
  children,
  busy,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  /** Label while the action runs, e.g. "Saving…". Defaults to children. */
  busy?: React.ReactNode;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} title={title} disabled={pending} aria-busy={pending}>
      {pending ? (busy ?? children) : children}
    </button>
  );
}
