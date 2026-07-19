export function formatDuration(from: Date, to: Date = new Date()): string {
  const ms = Math.max(0, to.getTime() - from.getTime());
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
};

export const STAGE_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  PAUSED: "Paused",
  REWORK: "Rework",
  DONE: "Done",
};

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  MATERIAL_SHORTAGE: "Material Shortage",
  LABOUR_SHORTAGE: "Labour Shortage",
  OTHER: "Other",
};

export const ACTIVITY_LABELS: Record<string, string> = {
  MATERIAL_HANDLING: "🚚 Material Handling",
  DISPATCH: "📦 Dispatch",
};

export function jobCode(jobNumber: number): string {
  return `JOB-${String(jobNumber).padStart(4, "0")}`;
}
