"use client";

import { useActionState, useState } from "react";
import { createJob } from "@/lib/actions/jobs";

type Props = {
  units: { id: string; name: string }[];
  templates: { id: string; name: string; stageNames: string[] }[];
};

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base";
const labelCls = "block text-sm font-medium mb-1";

export function JobCreateForm({ units, templates }: Props) {
  const [state, action, pending] = useActionState(createJob, undefined);
  const [mode, setMode] = useState<"template" | "custom">(
    templates.length > 0 ? "template" : "custom"
  );
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === selectedTemplate);

  return (
    <form action={action} className="bg-white rounded-xl shadow p-6 space-y-4">
      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{state.error}</p>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Client name *</label>
          <input name="clientName" required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Buyer (if different)</label>
          <input name="buyerName" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>PO number / reference</label>
          <input name="poNumber" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Unit *</label>
          <select name="unitId" required className={inputCls}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Description / equipment type *</label>
        <input
          name="description"
          required
          placeholder="e.g. Transformer Tank, APH, Bag Filter, Pressure Vessel"
          className={inputCls}
        />
      </div>

      {/* Drawings & BOM */}
      <fieldset className="border border-slate-200 rounded-lg p-3 space-y-3">
        <legend className="text-sm font-semibold px-1">Job documents</legend>
        <div>
          <label className={labelCls}>Drawings (PDF, DWG, images…)</label>
          <input
            type="file"
            name="drawings"
            multiple
            className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </div>
        <div>
          <label className={labelCls}>Bill of Material (PDF, Excel…)</label>
          <input
            type="file"
            name="bomFiles"
            multiple
            className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </div>
        <p className="text-xs text-slate-500">
          Up to 10 MB per file. More documents can be added later from the job page.
        </p>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Expected completion date *</label>
          <input name="expectedCompletion" type="date" required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Remind how many days before?</label>
          <input
            name="reminderDaysBefore"
            type="number"
            min={0}
            defaultValue={7}
            className={inputCls}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="priority" className="h-4 w-4" />
        Priority job
      </label>

      {/* Stage source: template or custom */}
      <fieldset className="border-t border-slate-100 pt-4">
        <legend className="text-sm font-semibold mb-2">Stages</legend>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setMode("template")}
            disabled={templates.length === 0}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              mode === "template"
                ? "bg-blue-600 text-white border-blue-600"
                : "border-slate-300 disabled:opacity-40"
            }`}
          >
            From template
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              mode === "custom" ? "bg-blue-600 text-white border-blue-600" : "border-slate-300"
            }`}
          >
            Custom stages
          </button>
        </div>

        {mode === "template" ? (
          <div className="space-y-2">
            <select
              name="templateId"
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className={inputCls}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {template && (
              <ol className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 list-decimal list-inside space-y-0.5">
                {template.stageNames.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>One stage per line, in order *</label>
              <textarea
                name="customStages"
                rows={6}
                placeholder={"Marking & Cutting\nEdge Preparation\nFit-up\nWelding\nTesting\nPainting & Dispatch"}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>
                Save these stages as a template (optional)
              </label>
              <input
                name="saveAsTemplate"
                placeholder={'e.g. "Transformer Tank Fabrication — Standard Process"'}
                className={inputCls}
              />
            </div>
          </div>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create Job"}
      </button>
      <p className="text-xs text-slate-500 text-center">
        The completion date is added to the deadline calendar feed automatically.
      </p>
    </form>
  );
}
