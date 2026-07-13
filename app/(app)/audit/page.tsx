import { db } from "@/lib/db";
import { requireRole } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireRole("SUPERADMIN");
  const { page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = 100;

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * perPage,
      take: perPage,
    }),
    db.auditLog.count(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Audit Trail</h1>
        <p className="text-sm text-slate-500">
          {total} entries · page {pageNum} of {Math.max(1, Math.ceil(total / perPage))}
        </p>
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-2 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {log.user ? (
                    log.user.name
                  ) : (
                    <span className="text-teal-700 font-medium">system (auto)</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{log.entityType}</td>
                <td className="px-4 py-2 text-xs text-slate-500 max-w-md truncate">
                  {log.details ? JSON.stringify(log.details) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 text-sm">
        {pageNum > 1 && (
          <a href={`/audit?page=${pageNum - 1}`} className="text-blue-600 hover:underline">
            ← Newer
          </a>
        )}
        {pageNum * perPage < total && (
          <a href={`/audit?page=${pageNum + 1}`} className="text-blue-600 hover:underline">
            Older →
          </a>
        )}
      </div>
    </div>
  );
}
