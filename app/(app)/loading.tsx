// Instant skeleton for every page in the app group while the server
// component streams in — navigation paints immediately instead of freezing
// on the old page.
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy>
      <div className="h-7 w-44 rounded-lg bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-xl bg-white shadow-sm p-4 space-y-3">
            <div className="h-4 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
            <div className="h-3 w-5/6 rounded bg-slate-100" />
            <div className="h-8 w-full rounded-lg bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
