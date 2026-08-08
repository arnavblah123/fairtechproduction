import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { runAgent, aiConfigured, MODEL } from "@/lib/ai/anthropic";

// Owner-only assistant. Second layer of defence: the page itself is hidden
// from everyone else, and this endpoint independently refuses anyone who is
// not the superadmin — a 403 even with a valid session.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM = `You are the assistant for Fairtech Engineers, a steel fabrication factory
with three units: Chinchwad (CH1), Dehu (DH2) and Savli (SV3). You are talking to the owner.

Answer from the factory's live data using the read-only tools — never guess a number.
If a tool returns nothing, say so plainly rather than inventing an answer.

Be brief and concrete: name jobs as JOB-0021 with their description, give figures with
their units (hours, ₹, kg, days), and lead with the answer before any explanation.
All dates and times are IST. You can read the data but cannot change anything; if the
owner asks you to change something, tell them which screen does it.`;

type Body = { messages?: { role: "user" | "assistant"; content: string }[] };

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  if (user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!aiConfigured()) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set on this app. Add it in Vercel → Settings → " +
          "Environment Variables, then redeploy.",
      },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const history = (body.messages ?? [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (history.length === 0) {
    return NextResponse.json({ error: "Ask a question first" }, { status: 400 });
  }

  try {
    const result = await runAgent({
      system: SYSTEM,
      messages: history,
      ctx: { source: "chat", runId: `chat-${Date.now()}`, userId: user.id },
    });
    return NextResponse.json({
      reply: result.text,
      model: MODEL,
      toolsUsed: result.toolsUsed.map((t) => t.name),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("assistant failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
