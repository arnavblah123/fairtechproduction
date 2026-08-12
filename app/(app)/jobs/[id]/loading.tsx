// Job-page skeleton: header strip, stage cards, documents block — mirrors
// the real layout so the swap-in doesn't jump.
export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy>
      <div className="rounded-xl bg-white shadow-sm p-4 space-y-3">
        <div className="h-6 w-3/5 rounded bg-slate-200" />
        <div className="flex gap-2">
          <div className="h-5 w-20 rounded-full bg-slate-200" />
          <div className="h-5 w-24 rounded-full bg-slate-100" />
        </div>
        <div className="h-3 w-2/5 rounded bg-slate-100" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="rounded-xl bg-white shadow-sm p-4 space-y-3">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-3 w-full rounded bg-slate-100" />
          <div className="h-3 w-4/5 rounded bg-slate-100" />
          <div className="h-9 w-40 rounded-lg bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
