import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "SYNC";

export interface AuditEntry {
  tenantId: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes the audit trail. Always called with the SAME transaction client as the
 * mutation it records, so the audit row commits atomically with the change —
 * you can't have a change without its audit entry, or vice versa.
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorId: entry.actorId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        before: entry.before === undefined ? null : JSON.stringify(entry.before),
        after: entry.after === undefined ? null : JSON.stringify(entry.after),
      },
    });
  }
}
