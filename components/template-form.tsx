"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveTemplate } from "@/lib/actions/templates";

type Props = {
  template: {
    id: string;
    name: string;
    equipmentName: string;
    description: string;
    stagesText: string;
  } | null;
};

const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-base";
const labelCls = "block text-sm font-medium mb-1";

export function TemplateForm({ template }: Props) {
  const [state, action, pending] = useActionState(saveTemplate, undefined);
  return (
    <form action={action} className="bg-white rounded-xl shadow p-6 space-y-4">
      {template && <input type="hidden" name="templateId" value={template.id} />}
      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
      )}
      <div>
        <label className={labelCls}>Template name *</label>
        <input
          name="name"
          required
          defaultValue={template?.name}
          placeholder='e.g. "Transformer Tank Fabrication — Standard Process"'
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Job / equipment name this process is for</label>
        <input
          name="equipmentName"
          defaultValue={template?.equipmentName}
          placeholder='e.g. "Transformer Tank" — typing this in a new job auto-selects this template'
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input name="description" defaultValue={template?.description} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>
          Stages — one per line, in order. Optional description after a “|”.
        </label>
        <textarea
          name="stages"
          rows={8}
          required
          defaultValue={template?.stagesText}
          placeholder={"Marking & Cutting\nEdge Preparation | Bevelling and grinding\nFit-up\nWelding\nTesting\nPainting & Dispatch"}
          className={inputCls}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save template"}
        </button>
        <Link href="/templates" className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium">
          Cancel
        </Link>
      </div>
      {template && (
        <p className="text-xs text-slate-500">
          Changes apply to future jobs only — jobs already created keep their stages.
        </p>
      )}
    </form>
  );
}
