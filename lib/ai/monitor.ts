import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { istToday } from "@/lib/overheads";
import { runAgent, aiConfigured } from "@/lib/ai/anthropic";

// The twice-daily production monitor. It reads its checklist from
// config/monitor-checklist.md so the owner can change what it checks without
// touching code, looks at live data through the read-only tools, and writes
// what it finds to daily_findings.

const FALLBACK_CHECKLIST = `You are the production monitor for Fairtech Engineers.
Check late jobs, jobs with no work logged today, clocks left running, missing
drawings and PO details, open issues, and dispatch risk in the next three days.
Report only what the owner should act on, naming the job or worker each time.`;

// Everything after the first "---" is the agent's instructions; the text above
// it is a note to whoever edits the file.
export function loadChecklist(): { text: string; source: string } {
  const candidates = [
    path.join(process.cwd(), "config", "monitor-checklist.md"),
    path.join(process.cwd(), "..", "config", "monitor-checklist.md"),
  ];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const idx = raw.indexOf("\n---");
      const text = (idx === -1 ? raw : raw.slice(idx + 4)).trim();
      if (text.length > 40) return { text, source: file };
    } catch {
      // try the next path
    }
  }
  return { text: FALLBACK_CHECKLIST, source: "built-in fallback" };
}

export type Finding = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  reference?: string | null;
};

const OUTPUT_RULES = `
When you have finished checking, reply with ONLY a JSON array of findings and
nothing else — no preamble, no markdown fence. Each element:
{"severity":"high|medium|low","title":"short headline","detail":"what and why it matters","reference":"JOB-0021 or worker name or null"}
Use an empty array [] only if you genuinely found nothing at all.`;

function parseFindings(text: string): Finding[] {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as unknown[];
    return raw
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        severity: (["high", "medium", "low"].includes(String(r.severity))
          ? String(r.severity)
          : "medium") as Finding["severity"],
        title: String(r.title ?? "Untitled finding").slice(0, 200),
        detail: String(r.detail ?? "").slice(0, 2000),
        reference: r.reference ? String(r.reference).slice(0, 100) : null,
      }))
      .filter((f) => f.title.trim().length > 0)
      .slice(0, 25);
  } catch {
    return [];
  }
}

export async function runMonitor(): Promise<{
  ok: boolean;
  written: number;
  toolCalls: number;
  checklistSource: string;
  error?: string;
}> {
  const { text: checklist, source } = loadChecklist();
  if (!aiConfigured()) {
    return {
      ok: false,
      written: 0,
      toolCalls: 0,
      checklistSource: source,
      error: "ANTHROPIC_API_KEY is not set — the monitoring agent cannot run.",
    };
  }

  const runId = `monitor-${Date.now()}`;
  const nowIst = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  try {
    const result = await runAgent({
      system: `${checklist}\n${OUTPUT_RULES}`,
      messages: [
        {
          role: "user",
          content:
            `It is ${nowIst} (IST). Run the checklist against today's live data and report what you find.`,
        },
      ],
      ctx: { source: "monitor", runId },
      maxTokens: 4096,
    });

    const findings = parseFindings(result.text);
    const day = istToday();

    // Try to attach each finding to the job it names, so the panel can link.
    const jobs = await db.job.findMany({
      where: { status: { not: "COMPLETED" } },
      select: { id: true, jobNumber: true },
    });
    const jobIdByNumber = new Map(jobs.map((j) => [j.jobNumber, j.id]));
    const jobIdFor = (ref?: string | null) => {
      if (!ref) return null;
      const m = /JOB-0*(\d+)/i.exec(ref) ?? /\b(\d{1,5})\b/.exec(ref);
      return m ? jobIdByNumber.get(Number(m[1])) ?? null : null;
    };

    // Each run replaces its own slot for the day so the panel never fills with
    // duplicates: findings are keyed by run, older runs of the same day stay.
    if (findings.length > 0) {
      await db.dailyFinding.createMany({
        data: findings.map((f) => ({
          day,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          reference: f.reference ?? null,
          jobId: jobIdFor(f.reference),
        })),
      });
    }
    return {
      ok: true,
      written: findings.length,
      toolCalls: result.toolsUsed.length,
      checklistSource: source,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("monitor run failed:", error);
    return { ok: false, written: 0, toolCalls: 0, checklistSource: source, error };
  }
}
