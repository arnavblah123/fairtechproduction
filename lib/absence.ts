// Why a worker isn't in today, asked on the dashboard's off-list.
export const ABSENCE_LABELS: Record<string, string> = {
  INFORMED_LEAVE: "On leave (asked / informed)",
  LEAVE_WITHOUT_ASKING: "Took leave without asking",
  NIGHT_SHIFT_REST: "Worked the night — resting",
  NOT_PICKING_UP: "Not picking up the phone",
  OTHER: "Other reason",
};

// Absences that reflect on the worker — filed as a complaint against them.
export const COMPLAINT_ABSENCES = ["LEAVE_WITHOUT_ASKING", "NOT_PICKING_UP"];
