"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

// Ticking "since when" duration for active assignments.
export function LiveDuration({ since }: { since: string | Date }) {
  const start = new Date(since);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return <span suppressHydrationWarning>{formatDuration(start)}</span>;
}
