"use client";

import { useEffect, useState } from "react";
import { AttachmentUpload } from "@/components/attachment-upload";
import { reuseDrawing } from "@/lib/actions/drawings";

export type PastJobDrawing = {
  jobId: string;
  label: string; // "JOB-0018 ATM XTM/19 — Thermax Ltd (12 Jul 2026)"
  drawings: { id: string; filename: string; mimeType: string }[];
};

// Adding a drawing: upload a new file, or reuse one from an earlier job.
// Reuse always ends with the same question — has the drawing changed? — and a
// "not sure" answer deliberately attaches nothing.
//
// The past-jobs list is fetched on demand (only once "reuse" is opened),
// not passed in from the job page — that query scans every job with a
// drawing and used to run on every single job view.
export function DrawingPicker({ jobId, jobName }: { jobId: string; jobName: string }) {
  const [mode, setMode] = useState<"none" | "new" | "reuse">("none");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PastJobDrawing | null>(null);
  const [pastJobs, setPastJobs] = useState<PastJobDrawing[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (mode !== "reuse" || pastJobs !== null) return;
    fetch(`/api/past-drawings?exclude=${jobId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setPastJobs(data.jobs))
      .catch(() => setLoadError(true));
  }, [mode, pastJobs, jobId]);

  const q = query.trim().toLowerCase();
  const shown = (
    q ? (pastJobs ?? []).filter((j) => j.label.toLowerCase().includes(q)) : (pastJobs ?? [])
  ).slice(0, 30);

  const tab = (active: boolean) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${
      active ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setMode("new")} className={tab(mode === "new")}>
          ⬆️ Upload new drawing
        </button>
        <button onClick={() => setMode("reuse")} className={tab(mode === "reuse")}>
          ♻️ Use drawing from a previous job
        </button>
      </div>

      {mode === "new" && (
        <div className="rounded-lg border border-slate-200 p-3">
          <AttachmentUpload jobId={jobId} />
          <p className="text-xs text-slate-500 mt-2">
            The file is saved under this job&apos;s name, so it stays recognisable if it is ever
            reused on another job.
          </p>
        </div>
      )}

      {mode === "reuse" && (
        <div className="rounded-lg border border-slate-200 p-3 space-y-2">
          {!picked ? (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search past jobs by name, client or number…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
              />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {pastJobs === null && !loadError && (
                  <p className="text-sm text-slate-400 px-1 py-2">Loading past jobs…</p>
                )}
                {loadError && (
                  <p className="text-sm text-red-600 px-1 py-2">
                    Could not load past jobs — try again.
                  </p>
                )}
                {shown.map((j) => (
                  <button
                    key={j.jobId}
                    onClick={() => setPicked(j)}
                    className="block w-full text-left rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 text-sm"
                  >
                    {j.label}
                    <span className="block text-xs text-slate-500">
                      {j.drawings.length} drawing{j.drawings.length === 1 ? "" : "s"}:{" "}
                      {j.drawings.map((d) => d.filename).join(", ").slice(0, 90)}
                    </span>
                  </button>
                ))}
                {pastJobs !== null && shown.length === 0 && (
                  <p className="text-sm text-slate-400 px-1 py-2">
                    {pastJobs.length === 0 ? "No earlier job has a drawing yet." : "No past job matches."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{picked.label}</p>
                <button
                  onClick={() => setPicked(null)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  ← choose another job
                </button>
              </div>

              {/* Preview: look at it before deciding */}
              <div className="space-y-2">
                {picked.drawings.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50">
                      <span className="text-xs truncate">{d.filename}</span>
                      <a
                        href={`/api/attachments/${d.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                      >
                        open full size ↗
                      </a>
                    </div>
                    {d.mimeType.startsWith("image/") ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/api/attachments/${d.id}`}
                        alt={d.filename}
                        className="w-full max-h-72 object-contain bg-white"
                      />
                    ) : d.mimeType === "application/pdf" ? (
                      <object
                        data={`/api/attachments/${d.id}`}
                        type="application/pdf"
                        className="w-full h-72"
                      >
                        <p className="p-3 text-xs text-slate-500">
                          Preview not supported on this phone — tap “open full size”.
                        </p>
                      </object>
                    ) : (
                      <p className="p-3 text-xs text-slate-500">
                        No preview for this file type — tap “open full size”.
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* The question that must be answered */}
              <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 space-y-2">
                <p className="text-sm font-semibold text-amber-900">
                  Are there any changes between that job&apos;s drawing and {jobName}?
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={reuseDrawing}>
                    <input type="hidden" name="toJobId" value={jobId} />
                    <input type="hidden" name="fromJobId" value={picked.jobId} />
                    <input type="hidden" name="answer" value="same" />
                    <button className="rounded-lg bg-green-600 text-white px-3 py-2 text-sm font-medium">
                      No changes — use this drawing
                    </button>
                  </form>
                  <form action={reuseDrawing}>
                    <input type="hidden" name="toJobId" value={jobId} />
                    <input type="hidden" name="fromJobId" value={picked.jobId} />
                    <input type="hidden" name="answer" value="changed" />
                    <button className="rounded-lg bg-amber-600 text-white px-3 py-2 text-sm font-medium">
                      There are changes / not sure
                    </button>
                  </form>
                </div>
                <p className="text-xs text-amber-800">
                  “Not sure” attaches nothing and puts “Upload updated drawing for {jobName}” on
                  your to-do list, so nobody builds to the wrong drawing.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
