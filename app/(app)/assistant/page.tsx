import { notFound } from "next/navigation";
import { requireUser } from "@/lib/permissions";
import { AssistantChat } from "@/components/assistant-chat";
import { aiConfigured } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";

// Owner-only. The role is checked on the server before anything renders, so
// for everyone else this route simply does not exist — no flash of the page,
// no greyed-out screen. The API behind it refuses non-superadmins as well.
export default async function AssistantPage() {
  const user = await requireUser();
  if (user.role !== "SUPERADMIN") notFound();

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">🤖 Ask about the factory</h1>
        <p className="text-sm text-slate-600 mt-1">
          Questions about jobs, hours, attendance, issues and planning — answered from live data.
          It can read everything but change nothing.
        </p>
      </div>
      {!aiConfigured() && (
        <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <b>Not switched on yet.</b> Add <code>ANTHROPIC_API_KEY</code> in Vercel → Settings →
          Environment Variables and redeploy, then this page will answer.
        </p>
      )}
      <AssistantChat />
    </div>
  );
}
