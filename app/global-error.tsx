"use client";

// Last-resort screen: catches failures in the root layout itself, where the
// per-page error screen cannot help. Must render its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a", margin: 0 }}>
        <div style={{ maxWidth: 420, margin: "60px auto", padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 40, margin: 0 }}>⚠️</p>
          <h1 style={{ fontSize: 18 }}>Fairtech could not start this screen</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>
            Your data is safe. Try again — if it keeps happening, open the health check
            below and send Arnav what it says.
          </p>
          {error.digest && (
            <p style={{ fontFamily: "monospace", fontSize: 12, background: "#e2e8f0", padding: "4px 8px", display: "inline-block", borderRadius: 4 }}>
              {error.digest}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={reset}
              style={{ background: "#0f172a", color: "#fff", border: 0, borderRadius: 8, padding: "8px 16px", fontSize: 14 }}
            >
              Try again
            </button>
            <a
              href="/api/health"
              style={{ background: "#e2e8f0", color: "#0f172a", borderRadius: 8, padding: "8px 16px", fontSize: 14, textDecoration: "none" }}
            >
              Check app health
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
