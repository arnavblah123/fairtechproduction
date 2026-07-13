"use client";

import { useActionState, useRef, useEffect } from "react";
import { addAttachments } from "@/lib/actions/attachments";

export function AttachmentUpload({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(addAttachments, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state === undefined) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-wrap gap-2 items-center">
      <input type="hidden" name="jobId" value={jobId} />
      <select name="kind" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
        <option value="DRAWING">Drawing</option>
        <option value="BOM">Bill of Material</option>
        <option value="OTHER">Other</option>
      </select>
      <input
        type="file"
        name="files"
        multiple
        required
        className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
      />
      <button
        disabled={pending}
        className="rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload"}
      </button>
      {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
