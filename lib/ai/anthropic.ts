import { TOOLS, runTool, type ToolContext } from "@/lib/ai/tools";

// Thin Anthropic Messages API client with the tool loop. No SDK dependency:
// one fetch, the documented request shape, and a loop that runs the tools the
// model asks for until it answers in words.

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const API_URL = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com/v1/messages";
const MAX_TOOL_ROUNDS = 8;

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type ChatMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type AgentResult = {
  text: string;
  messages: ChatMessage[];
  toolsUsed: { name: string; input: Record<string, unknown> }[];
};

async function callApi(body: unknown): Promise<{
  content: ContentBlock[];
  stop_reason: string;
}> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set on this app.");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

// Runs the conversation, executing any tools the model asks for.
export async function runAgent({
  system,
  messages,
  ctx,
  maxTokens = 2048,
}: {
  system: string;
  messages: ChatMessage[];
  ctx: ToolContext;
  maxTokens?: number;
}): Promise<AgentResult> {
  const convo: ChatMessage[] = [...messages];
  const toolsUsed: { name: string; input: Record<string, unknown> }[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await callApi({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools: TOOLS,
      messages: convo,
    });

    convo.push({ role: "assistant", content: reply.content });

    const toolUses = reply.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use"
    );
    if (reply.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = reply.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text, messages: convo, toolsUsed };
    }

    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      toolsUsed.push({ name: use.name, input: use.input });
      const result = await runTool(use.name, use.input ?? {}, ctx);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result).slice(0, 60000),
      });
    }
    convo.push({ role: "user", content: results });
  }

  return {
    text:
      "I looked at a lot of data but could not finish within the tool limit. " +
      "Try asking about one job or one day at a time.",
    messages: convo,
    toolsUsed,
  };
}
