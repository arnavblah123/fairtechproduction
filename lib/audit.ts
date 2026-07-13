import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Every state change goes through here. userId = null means the system
// (e.g. attendance webhook) made the change.
export async function audit(
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  details?: Prisma.InputJsonValue,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;
  await client.auditLog.create({
    data: { userId, action, entityType, entityId, details },
  });
}
