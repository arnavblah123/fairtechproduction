"use client";

// One-tap print → the browser's print dialog doubles as save-to-PDF.
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium print:hidden"
    >
      🖨 Print / PDF
    </button>
  );
}
