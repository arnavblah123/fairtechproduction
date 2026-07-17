import {
  JOB_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  ISSUE_TYPE_LABELS,
} from "@/lib/format";

const jobStatusStyles: Record<string, string> = {
  NOT_STARTED: "bg-slate-200 text-slate-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  ON_HOLD: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-green-100 text-green-800",
};

const stageStatusStyles: Record<string, string> = {
  PENDING: "bg-slate-200 text-slate-700",
  ACTIVE: "bg-blue-100 text-blue-800",
  PAUSED: "bg-amber-100 text-amber-800",
  REWORK: "bg-purple-100 text-purple-800",
  DONE: "bg-green-100 text-green-800",
};

const base =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function JobStatusBadge({ status }: { status: string }) {
  return (
    <span className={`${base} ${jobStatusStyles[status] ?? ""}`}>
      {JOB_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function StageStatusBadge({ status }: { status: string }) {
  return (
    <span className={`${base} ${stageStatusStyles[status] ?? ""}`}>
      {STAGE_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function IssueBadge({ type, count }: { type?: string; count?: number }) {
  return (
    <span className={`${base} bg-red-100 text-red-800`}>
      {count !== undefined
        ? `${count} open issue${count === 1 ? "" : "s"}`
        : ISSUE_TYPE_LABELS[type ?? "OTHER"] ?? type}
    </span>
  );
}

export function PriorityBadge() {
  return <span className={`${base} bg-purple-100 text-purple-800`}>Priority</span>;
}

export function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    SUPERADMIN: "bg-purple-100 text-purple-800",
    ADMIN: "bg-blue-100 text-blue-800",
    SUPERVISOR: "bg-teal-100 text-teal-800",
  };
  const labels: Record<string, string> = {
    SUPERADMIN: "Superadmin",
    ADMIN: "Admin",
    SUPERVISOR: "Supervisor",
  };
  return <span className={`${base} ${styles[role] ?? ""}`}>{labels[role] ?? role}</span>;
}
