"use client";

import { useActionState, useState } from "react";
import { createJob } from "@/lib/actions/jobs";

type Props = {
  units: { id: string; name: string }[];
  templates: { id: string; name: string; stageNames: string[] }[];
};

const STANDARD_TESTS = [
  "DP Test",
  "RT Test",
  "Hydro Test",
  "Kerosene / Leak Test",
  "UT Test",
  "Dimension Inspection",
  "Final Painting Inspection",
  "Final Inspection",
];

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base";
const labelCls = "block text-sm font-medium mb-1";

export function JobCreateForm({ units, templates }: Props) {
  const [state, action, pending] = useActionState(createJob, undefined);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [stagesText, setStagesText] = useState("");

  const stageLines = stagesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  function applyTemplate(id: string) {
    setSelectedTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (t) setStagesText(t.stageNames.join("\n"));
  }

  // Stage picker for a test: which stage the test happens after.
  function StageSelect({ name }: { name: string }) {
    return (
      <select
        name={name}
        defaultValue=""
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm max-w-44"
      >
        <option value="">Final (whole job)</option>
        {stageLines.map((line, i) => (
          <option key={i} value={i + 1}>
            after {i + 1}. {line.length > 22 ? line.slice(0, 22) + "…" : line}
          </option>
        ))}
      </select>
    );
  }

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

      {/* Stages: template pre-fills, always editable for this job */}
      <fieldset className="border-t border-slate-100 pt-4 space-y-3">
        <legend className="text-sm font-semibold">Stages</legend>
        <div>
          <label className={labelCls}>Start from a template (optional)</label>
          <select
            name="templateId"
            value={selectedTemplate}
            onChange={(e) => applyTemplate(e.target.value)}
            className={inputCls}
          >
            <option value="">— No template, type stages below —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>
            Stages for this job — one per line, in order. *
          </label>
          <textarea
            name="customStages"
            rows={8}
            required
            value={stagesText}
            onChange={(e) => setStagesText(e.target.value)}
            placeholder={"Marking & Cutting\nEdge Preparation\nFit-up\nWelding\nTesting\nPainting & Dispatch"}
            className={inputCls}
          />
          <p className="text-xs text-slate-500 mt-1">
            Free to add, remove or reorder lines for this job — the saved
            template is not changed.
          </p>
        </div>
        <div>
          <label className={labelCls}>
            Save this stage list as a new template (optional)
          </label>
          <input
            name="saveAsTemplate"
            placeholder='e.g. "Transformer Tank — With Stress Relieving"'
            className={inputCls}
          />
        </div>
      </fieldset>

      {/* Testing plan */}
      <fieldset className="border-t border-slate-100 pt-4 space-y-2">
        <legend className="text-sm font-semibold">
          Testing required on this job
        </legend>
        {STANDARD_TESTS.map((test, i) => (
          <div key={test} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium w-44">
              <input type="checkbox" name={`test_${i}`} className="h-4 w-4" />
              {test}
              <input type="hidden" name={`test_${i}_name`} value={test} />
            </label>
            <StageSelect name={`test_${i}_stage`} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="otherTest"
            placeholder="Other test (type name)"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm w-44"
          />
          <StageSelect name="otherTest_stage" />
        </div>
        <p className="text-xs text-slate-500">
          Tick the tests needed and choose after which stage each one happens.
        </p>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create Job"}
      </button>
      <p className="text-xs text-slate-500 text-center">
        The completion date is added to the deadline calendar automatically.
      </p>
    </form>
  );
}
