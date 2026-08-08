"use client";

import { useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

const SUGGESTIONS = [
  "Which jobs are running late and why?",
  "Who worked on JOB-0021 and for how many hours?",
  "Who is absent today without a reason?",
  "What needs my attention before dispatch this week?",
];

export function AssistantChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
      } else {
        setMessages([
          ...next,
          { role: "assistant", content: data.reply || "(no answer)", tools: data.toolsUsed },
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the assistant");
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl shadow-sm p-4 min-h-64 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full text-left rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 text-sm"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap text-left ${
                m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100"
              }`}
            >
              {m.content}
            </div>
            {m.tools && m.tools.length > 0 && (
              <p className="text-[11px] text-slate-400 mt-0.5">
                looked at: {[...new Set(m.tools)].join(", ").replace(/_/g, " ")}
              </p>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-slate-400">Reading the data…</p>}
        {error && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about jobs, hours, attendance…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      {messages.length > 0 && (
        <button
          onClick={() => {
            setMessages([]);
            setError(null);
          }}
          className="text-xs text-slate-500 hover:underline"
        >
          Clear conversation
        </button>
      )}
    </div>
  );
}
