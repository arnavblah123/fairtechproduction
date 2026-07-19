import type { DisciplineReason } from "@prisma/client";

// Fixed hour cuts per reason. OTHER takes a custom figure (note required).
export const DISCIPLINE_HOURS: Record<Exclude<DisciplineReason, "OTHER">, number> = {
  DRINKING: 16,
  TIMEPASS: 8,
  TOBACCO: 4,
};

export const DISCIPLINE_LABELS: Record<DisciplineReason, string> = {
  DRINKING: "Drinking",
  TIMEPASS: "Timepass",
  TOBACCO: "Tobacco / Cigarette",
  OTHER: "Other",
};
