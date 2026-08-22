"use client";

import { useActionState, useRef, useState } from "react";
import { createJob } from "@/lib/actions/jobs";

type Props = {
  units: { id: string; name: string }[];
  templates: {
    id: string;
    name: string;
    equipmentName: string | null;
    stageNames: string[];
  }[];
  clientNames: string[];
  buyerNames: string[];
  /** Job names already used, so the same part is spelled the same way twice. */
  jobNames: string[];
  prefill?: {
    clientName: string;
    description: string;
    unitId: string;
    buyerName?: string;
    poNumber?: string;
    expectedCompletion?: string; // yyyy-mm-dd
    finishedWeightKg?: string;
    reminderDaysBefore?: string;
    priority?: boolean;
    templateId?: string;
    stagesText?: string;
  };
  /** Set when this form was opened to release an order-book entry: the
   *  booking is deleted once the job is created. */
  fromFutureJobId?: string;
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

type JobMemory = {
  jobId: string;
  label: string;
  finishedWeightKg: number | null;
  templateId: string | null;
  templateName: string | null;
  stageNames: string[];
  drawings: string[];
  boms: string[];
};

type PastJob = {
  jobId: string;
  label: string;
  finishedWeightKg: number | null;
  drawings: { id: string; filename: string }[];
  boms: { id: string; filename: string }[];
};

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-base";
const labelCls = "block text-sm font-medium mb-1";

export function JobCreateForm({
  units,
  templates,
  clientNames,
  buyerNames,
  jobNames,
  prefill,
  fromFutureJobId,
}: Props) {
  const [state, action, pending] = useActionState(createJob, undefined);
  const [selectedTemplate, setSelectedTemplate] = useState(prefill?.templateId ?? "");
  const [stagesText, setStagesText] = useState(prefill?.stagesText ?? "");
  const [autoMatched, setAutoMatched] = useState<string | null>(null);
  const [materialReady, setMaterialReady] = useState("yes");
  // Production goes straight onto the unit's board; the order book holds work
  // that is sold but not yet released to the floor.
  const [destination, setDestination] = useState<"PRODUCTION" | "ORDER_BOOK">("PRODUCTION");
  const booking = destination === "ORDER_BOOK";
  // What this job name was built as last time — looked up when the name is
  // typed, so the process and the drawings need not be re-entered.
  const [memory, setMemory] = useState<JobMemory | null>(null);
  const [templateAnswer, setTemplateAnswer] = useState<"" | "same" | "different">("");
  const [filesAnswer, setFilesAnswer] = useState<"" | "same" | "changed">("");
  // Controlled so that reusing an earlier job's documents can fill in the
  // weight too — the same part built again weighs the same.
  const [weight, setWeight] = useState(prefill?.finishedWeightKg ?? "");
  // Picking documents off any earlier job, not just the one this job name
  // matched. Nothing is applied until the change question is answered.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pastJobs, setPastJobs] = useState<PastJob[] | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerError, setPickerError] = useState(false);
  const [candidate, setCandidate] = useState<PastJob | null>(null);
  const [reuseFrom, setReuseFrom] = useState<PastJob | null>(null);

  // The list is fetched the first time the picker is opened — it scans every
  // job that has a drawing, so it must not run on every form view.
  function openPicker() {
    setPickerOpen(true);
    if (pastJobs !== null) return;
    fetch("/api/past-drawings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setPastJobs(data.jobs))
      .catch(() => setPickerError(true));
  }

  function applyReuse(job: PastJob) {
    setReuseFrom(job);
    setCandidate(null);
    setPickerOpen(false);
    setFilesAnswer(""); // the picker's answer replaces the name-match one
    if (job.finishedWeightKg) setWeight(String(job.finishedWeightKg));
  }
  // Remember the last auto/template fill so we never overwrite manual edits.
  const lastApplied = useRef("");

  const stageLines = stagesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  function applyTemplate(id: string) {
    setSelectedTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      const text = t.stageNames.join("\n");
      setStagesText(text);
      lastApplied.current = text;
    }
  }

  // Leaving the job name asks the server what that name was built as last
  // time. Nothing is applied automatically — the answers below decide.
  async function lookupJobName(value: string) {
    const name = value.trim();
    if (name.length < 2) {
      setMemory(null);
      return;
    }
    try {
      const res = await fetch(`/api/job-memory?name=${encodeURIComponent(name)}`);
      const data = res.ok ? await res.json() : { found: false };
      setMemory(data.found ? (data as JobMemory) : null);
      setTemplateAnswer("");
      setFilesAnswer("");
    } catch {
      setMemory(null); // offline or slow — the form still works by hand
    }
  }

  // Typing a known equipment name in the job name auto-selects its
  // template — but only while the stage box hasn't been edited by hand.
  function onDescriptionChange(value: string) {
    const lower = value.toLowerCase();
    const match = templates
      .filter((t) => t.equipmentName && lower.includes(t.equipmentName.toLowerCase()))
      .sort((a, b) => (b.equipmentName!.length - a.equipmentName!.length))[0];
    if (!match || match.id === selectedTemplate) return;
    if (stagesText !== "" && stagesText !== lastApplied.current) return;
    applyTemplate(match.id);
    setAutoMatched(match.name);
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

      {fromFutureJobId && (
        <input type="hidden" name="fromFutureJobId" value={fromFutureJobId} />
      )}

      {/* Production or order book — the rest of the form is the same either way */}
      <fieldset className="space-y-2">
        <legend className={labelCls}>Where does this go? *</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["PRODUCTION", "🏭 Production", "Goes on the unit's board now"],
              ["ORDER_BOOK", "📒 Order book", "Booked, not yet on the floor"],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-center ${
                destination === value
                  ? "border-blue-600 bg-blue-50 text-blue-900"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="destination"
                value={value}
                checked={destination === value}
                onChange={() => setDestination(value)}
                className="sr-only"
              />
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block text-[11px] leading-tight mt-0.5">{hint}</span>
            </label>
          ))}
        </div>
        {booking && (
          <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            Saved to the order book for this unit. No stages are created and no
            work can be clocked against it. Attach the drawings now if you have
            them — they land on the job when you release it. Material and
            testing are asked at release.
          </p>
        )}
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Client name *</label>
          <input
            name="clientName"
            required
            list="client-names"
            defaultValue={prefill?.clientName}
            className={inputCls}
          />
          <datalist id="client-names">
            {clientNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>Buyer (if different)</label>
          <input
            name="buyerName"
            list="buyer-names"
            defaultValue={prefill?.buyerName}
            className={inputCls}
          />
          <datalist id="buyer-names">
            {buyerNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={labelCls}>PO number / reference</label>
          <input name="poNumber" defaultValue={prefill?.poNumber} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Unit *</label>
          <select
            name="unitId"
            required
            defaultValue={prefill?.unitId || undefined}
            className={inputCls}
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Job name *</label>
        <input
          name="description"
          required
          list="equipment-names"
          defaultValue={prefill?.description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onBlur={(e) => lookupJobName(e.target.value)}
          placeholder="e.g. SFTSRG 15, CPRG 180, Transformer Tank, APH"
          className={inputCls}
        />
        {/* Names already used, so the same part is spelled the same way and
            its history can be found next time. */}
        <datalist id="equipment-names">
          {[
            ...new Set([
              ...jobNames,
              ...templates.map((t) => t.equipmentName).filter(Boolean) as string[],
            ]),
          ].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {autoMatched && (
          <p className="text-xs text-green-700 mt-1">
            ✓ Process template applied automatically: {autoMatched}
          </p>
        )}
      </div>

      {/* Built before under this name: reuse the process and the documents
          rather than typing and uploading them again. Both questions are
          asked, never assumed — the same name is not always the same part. */}
      {memory && (
        <fieldset className="rounded-lg border-2 border-blue-200 bg-blue-50/60 p-3 space-y-3">
          <legend className="text-sm font-semibold px-1 text-blue-900">
            ♻️ Built before — {memory.label}
          </legend>

          {memory.stageNames.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Same process as last time?
                {memory.templateName && (
                  <span className="font-normal text-slate-600"> ({memory.templateName})</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTemplateAnswer("same");
                    const text = memory.stageNames.join("\n");
                    setStagesText(text);
                    lastApplied.current = text;
                    if (memory.templateId) setSelectedTemplate(memory.templateId);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    templateAnswer === "same"
                      ? "bg-blue-600 text-white"
                      : "bg-white border border-blue-300 text-blue-800"
                  }`}
                >
                  Yes — use the same {memory.stageNames.length} stages
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateAnswer("different")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    templateAnswer === "different"
                      ? "bg-slate-700 text-white"
                      : "bg-white border border-slate-300 text-slate-700"
                  }`}
                >
                  No — this one is different
                </button>
              </div>
            </div>
          )}

          {(memory.drawings.length > 0 || memory.boms.length > 0) && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Any change in the drawing or BOM since then?
                <span className="block text-xs font-normal text-slate-600">
                  Last time: {memory.drawings.length} drawing
                  {memory.drawings.length === 1 ? "" : "s"}, {memory.boms.length} BOM
                  {memory.boms.length === 1 ? "" : "s"}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <label
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${
                    filesAnswer === "same"
                      ? "bg-blue-600 text-white"
                      : "bg-white border border-blue-300 text-blue-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="reuseFiles"
                    value="same"
                    checked={filesAnswer === "same"}
                    onChange={() => {
                      setFilesAnswer("same");
                      setReuseFrom(null); // the picker's choice, if any, gives way
                      if (memory.finishedWeightKg) setWeight(String(memory.finishedWeightKg));
                    }}
                    className="sr-only"
                  />
                  No change — use last time&apos;s files
                </label>
                <label
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${
                    filesAnswer === "changed"
                      ? "bg-slate-700 text-white"
                      : "bg-white border border-slate-300 text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="reuseFiles"
                    value="changed"
                    checked={filesAnswer === "changed"}
                    onChange={() => {
                      setFilesAnswer("changed");
                      setReuseFrom(null);
                    }}
                    className="sr-only"
                  />
                  Changed — I will attach new ones
                </label>
              </div>
              {filesAnswer === "same" && (
                <>
                  <input type="hidden" name="reuseFilesFromJobId" value={memory.jobId} />
                  <p className="text-xs text-blue-900">
                    ✓ {memory.drawings.concat(memory.boms).join(", ")} will be copied onto this{" "}
                    {booking ? "order" : "job"}
                    {memory.finishedWeightKg
                      ? `, and the weight filled in as ${memory.finishedWeightKg} kg`
                      : ""}
                    .
                  </p>
                </>
              )}
              {filesAnswer === "changed" && (
                <p className="text-xs text-amber-800">
                  Nothing is copied — attach the new files below. Left empty, the
                  {booking ? " order" : " job"} is flagged as waiting for its drawing.
                </p>
              )}
            </div>
          )}
        </fieldset>
      )}

      {/* Drawings & BOM — offered for a booking too: the drawing usually
          arrives with the order, long before a unit starts it. */}
      <fieldset className="border border-slate-200 rounded-lg p-3 space-y-3">
        <legend className="text-sm font-semibold px-1">
          {booking ? "Order documents" : "Job documents"}
        </legend>
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
          Up to 10 MB per file.{" "}
          {booking
            ? "They travel with the order and land on the job when you release it."
            : "More documents can be added later from the job page."}
        </p>

        {/* Reuse from any earlier job — not only the one this job name
            matched. The change question is always asked before anything is
            copied: building to last month's drawing costs far more than
            uploading a new file. */}
        <div className="border-t border-slate-100 pt-3 space-y-2">
          {reuseFrom ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 space-y-1">
              <p className="text-sm font-medium text-green-900">
                ♻️ Reusing documents from {reuseFrom.label}
              </p>
              <p className="text-xs text-green-800">
                {reuseFrom.drawings.length} drawing
                {reuseFrom.drawings.length === 1 ? "" : "s"}
                {reuseFrom.boms.length > 0 && (
                  <> and {reuseFrom.boms.length} BOM{reuseFrom.boms.length === 1 ? "" : "s"}</>
                )}{" "}
                will be copied onto this {booking ? "order" : "job"}
                {reuseFrom.finishedWeightKg ? `, weight ${reuseFrom.finishedWeightKg} kg filled in` : ""}.
              </p>
              <input type="hidden" name="reuseFilesFromJobId" value={reuseFrom.jobId} />
              <button
                type="button"
                onClick={() => setReuseFrom(null)}
                className="text-xs text-red-700 hover:underline"
              >
                Remove — I will attach new files
              </button>
            </div>
          ) : !pickerOpen ? (
            <button
              type="button"
              onClick={openPicker}
              className="rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm font-medium"
            >
              ♻️ Use drawings from a previous job
            </button>
          ) : (
            <div className="rounded-lg border border-slate-200 p-3 space-y-2">
              {candidate ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{candidate.label}</p>
                  <ul className="text-xs text-slate-600 space-y-0.5">
                    {candidate.drawings.concat(candidate.boms).map((f) => (
                      <li key={f.id} className="break-all">
                        {f.filename}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm font-medium text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
                    Confirm: has anything changed in the drawing or BOM since
                    that job? If there is any doubt at all, say no and attach
                    the new file instead.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => applyReuse(candidate)}
                      className="rounded-lg bg-green-600 text-white px-3 py-1.5 text-sm font-medium"
                    >
                      No change — use these files
                    </button>
                    <button
                      type="button"
                      onClick={() => setCandidate(null)}
                      className="rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-sm font-medium"
                    >
                      Not sure — go back
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="Search by job number, name or client…"
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setPickerOpen(false)}
                      className="text-sm text-slate-500 hover:underline"
                    >
                      Close
                    </button>
                  </div>
                  {pickerError ? (
                    <p className="text-xs text-red-600">
                      Could not load previous jobs. Attach the files by hand.
                    </p>
                  ) : pastJobs === null ? (
                    <p className="text-xs text-slate-500">Loading previous jobs…</p>
                  ) : (
                    <ul className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {pastJobs
                        .filter((j) =>
                          j.label.toLowerCase().includes(pickerQuery.trim().toLowerCase())
                        )
                        .slice(0, 30)
                        .map((j) => (
                          <li key={j.jobId}>
                            <button
                              type="button"
                              onClick={() => setCandidate(j)}
                              className="w-full text-left py-2 text-sm hover:bg-slate-50"
                            >
                              {j.label}
                              <span className="block text-xs text-slate-500">
                                {j.drawings.length} drawing
                                {j.drawings.length === 1 ? "" : "s"}
                                {j.boms.length > 0 && <>, {j.boms.length} BOM</>}
                                {j.finishedWeightKg ? ` · ${j.finishedWeightKg} kg` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      {pastJobs.length === 0 && (
                        <li className="py-2 text-sm text-slate-400">
                          No earlier job has a drawing yet.
                        </li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>
            {booking ? "Expected completion date (if promised)" : "Expected completion date *"}
          </label>
          <input
            name="expectedCompletion"
            type="date"
            required={!booking}
            defaultValue={prefill?.expectedCompletion}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Finished weight (kg)</label>
          <input
            name="finishedWeightKg"
            type="number"
            min={1}
            step="any"
            placeholder="e.g. 4500"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className={inputCls}
          />
          <p className="text-xs text-slate-500 mt-1">
            Weight of the finished job — used to budget cost, hours and material per kg.
          </p>
        </div>
        <div>
          <label className={labelCls}>Remind how many days before?</label>
          <input
            name="reminderDaysBefore"
            type="number"
            min={0}
            defaultValue={prefill?.reminderDaysBefore ?? 7}
            className={inputCls}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="priority"
          defaultChecked={prefill?.priority}
          className="h-4 w-4"
        />
        Priority job
      </label>

      {/* Material availability — "No" auto-raises a Material Shortage issue */}
      {!booking && (
      <fieldset className="border-t border-slate-100 pt-4 space-y-3">
        <legend className="text-sm font-semibold">Material</legend>
        <div>
          <label className={labelCls}>Is all material available for this job? *</label>
          <select
            name="materialReady"
            value={materialReady}
            onChange={(e) => setMaterialReady(e.target.value)}
            className={inputCls}
          >
            <option value="yes">Yes — all material available</option>
            <option value="no">No — some material is needed</option>
          </select>
        </div>
        {materialReady === "no" && (
          <div className="grid sm:grid-cols-2 gap-4 rounded-lg bg-amber-50 border border-amber-200 p-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>What material is needed? *</label>
              <textarea
                name="materialNote"
                required
                rows={2}
                placeholder="e.g. 12mm SA516 Gr70 plates 2 nos, SS304 pipe 3m…"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Needed by what date? *</label>
              <input name="materialNeededBy" type="date" required className={inputCls} />
            </div>
            <p className="text-xs text-amber-700 self-end">
              This raises a Material Shortage issue on the job automatically.
            </p>
          </div>
        )}
      </fieldset>
      )}

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
            {booking
              ? "Stages, if the process is already known — one per line, in order."
              : "Stages for this job — one per line, in order. *"}
          </label>
          <textarea
            name="customStages"
            rows={8}
            required={!booking}
            value={stagesText}
            onChange={(e) => setStagesText(e.target.value)}
            placeholder={"Marking & Cutting\nEdge Preparation\nFit-up\nWelding\nTesting\nPainting & Dispatch"}
            className={inputCls}
          />
          <p className="text-xs text-slate-500 mt-1">
            {booking
              ? "Carried into the job when this order is released — still editable then."
              : "Free to add, remove or reorder lines for this job — the saved template is not changed."}
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

      {/* Testing plan — tied to stage numbers, so it waits for the real job */}
      {!booking && (
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
      )}

      <button
        type="submit"
        disabled={pending}
        className={`w-full rounded-lg text-white py-2.5 font-medium disabled:opacity-50 ${
          booking ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
        }`}
      >
        {pending
          ? booking
            ? "Adding to order book…"
            : "Creating…"
          : booking
            ? "📒 Add to Order Book"
            : fromFutureJobId
              ? "Release to Production"
              : "Create Job"}
      </button>
      <p className="text-xs text-slate-500 text-center">
        {booking
          ? "Sits in the unit's order book until you release it to production."
          : "The completion date is added to the deadline calendar automatically."}
      </p>
    </form>
  );
}
