"use client";

import { useActionState, useRef } from "react";
import { addAttachments } from "@/lib/actions/attachments";

// One-tap drawing upload for the morning list: the button opens the file
// picker straight away, and picking a file submits it — no trip to the job
// page. The server action names the file after the job and ticks off the
// reminder, so the row disappears once the upload lands.
export function QuickDrawingUpload({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(addAttachments, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="kind" value="DRAWING" />
      <input
        ref={fileRef}
        type="file"
        name="files"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.currentTarget.files?.length) formRef.current?.requestSubmit();
        }}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => fileRef.current?.click()}
        className="rounded bg-blue-600 text-white px-2.5 py-1 text-xs font-medium disabled:opacity-60"
      >
        {pending ? "Uploading…" : "⬆ Upload file"}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
