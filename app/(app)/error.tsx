"use client";

import { useEffect } from "react";
import Link from "next/link";

// Shown instead of a blank "Application error" page when something breaks on
// a screen. Gives the shop floor a way back, and gives us the digest to look
// up in the Vercel logs.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page error:", error);
  }, [error]);

  return (
    <div className="max-w-md mx-auto mt-10 space-y-4 text-center">
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
        <p className="text-4xl">⚠️</p>
        <h1 className="text-lg font-bold">This screen could not load</h1>
        <p className="text-sm text-slate-600">
          Nothing has been lost — your data is safe. Try again, and if it keeps happening
          send this code to Arnav.
        </p>
        {error.digest && (
          <p className="text-xs font-mono bg-slate-100 rounded px-2 py-1 inline-block">
            {error.digest}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <button
            onClick={reset}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium"
          >
            Dashboard
          </Link>
          <a
            href="/api/health"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium"
          >
            Check app health
          </a>
        </div>
      </div>
    </div>
  );
}
