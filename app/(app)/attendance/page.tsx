import { db } from "@/lib/db";
import { requireUser, isAdmin } from "@/lib/permissions";
import { simulateAttendanceEvent } from "@/lib/actions/attendance";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const user = await requireUser();
  const [events, employees] = await Promise.all([
    db.attendanceEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 100 }),
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Attendance Events</h1>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <p className="font-semibold mb-1">Integration status: stub mode</p>
        <p>
          The real biometric system is not wired in yet. When the vendor is
          confirmed, it will POST login/logout events to{" "}
          <code className="bg-amber-100 px-1 rounded">/api/attendance/webhook</code>.
          Logout auto-stops a worker&apos;s clock; login auto-resumes them on
          their last stage unless a supervisor reassigned them in between.
        </p>
      </div>

      {isAdmin(user) && (
        <form
          action={simulateAttendanceEvent}
          className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap gap-2 items-center"
        >
          <span className="text-sm font-semibold">Simulate event:</span>
          <select name="employeeCode" required className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {employees.map((e) => (
              <option key={e.id} value={e.code}>
                {e.name} ({e.code})
              </option>
            ))}
          </select>
          <select name="eventType" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="LOGOUT">Logout (auto-stop clock)</option>
            <option value="LOGIN">Login (auto-resume)</option>
          </select>
          <button className="rounded-lg bg-slate-900 text-white px-4 py-1.5 text-sm">
            Send
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Employee code</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Processing result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(ev.occurredAt)}</td>
                <td className="px-4 py-2.5">{ev.employeeCode}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      ev.eventType === "LOGIN"
                        ? "bg-green-100 text-green-800"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {ev.eventType}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{ev.result ?? "pending"}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                  No attendance events received yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
