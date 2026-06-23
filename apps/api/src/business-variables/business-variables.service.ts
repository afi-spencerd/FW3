import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type AuthenticatedUser,
  type BusinessVariable,
  BUSINESS_VARIABLES,
  findBusinessVariable,
  isValidBusinessVariableValue,
  OPERATOR_ROLES,
  type OperatorRole,
  type UpdateBusinessVariables,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

/** Drop trailing zeros from a numeric string ("80.0000" -> "80", "14.50" -> "14.5"). */
function normalizeNumeric(value: string): string {
  return /^\d+(\.\d+)?$/.test(value)
    ? value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
    : value;
}

@Injectable()
export class BusinessVariablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The catalog resolved against this tenant's stored overrides (defaults fill gaps). */
  async list(tenantId: string): Promise<BusinessVariable[]> {
    const rows = await this.prisma.businessVariableValue.findMany({
      where: { tenantId },
    });
    // Key stored overrides by "key|role" ("" role for non-scoped).
    const stored = new Map(
      rows.map((r) => [`${r.key}|${r.operatorRole ?? ""}`, r.value]),
    );
    // Numeric values are normalized for display (legacy rows migrated from the
    // old decimal column may carry trailing zeros); TIME values pass through.
    const display = (type: string, raw: string): string =>
      type === "TIME" ? raw : normalizeNumeric(raw);

    return BUSINESS_VARIABLES.map((def) => {
      if (!def.roleScoped) {
        const override = stored.get(`${def.key}|`);
        return {
          key: def.key,
          label: def.label,
          group: def.group,
          type: def.type,
          unit: def.unit,
          roleScoped: false,
          entries: [
            {
              operatorRole: null,
              value: display(def.type, override ?? def.defaultValue),
              isDefault: override === undefined,
            },
          ],
        };
      }
      const entries = OPERATOR_ROLES.map((role) => {
        const override = stored.get(`${def.key}|${role}`);
        const fallback = def.roleDefaults?.[role] ?? def.defaultValue;
        return {
          operatorRole: role,
          value: display(def.type, override ?? fallback),
          isDefault: override === undefined,
        };
      });
      return {
        key: def.key,
        label: def.label,
        group: def.group,
        type: def.type,
        unit: def.unit,
        roleScoped: true,
        entries,
      };
    });
  }

  /** Apply value overrides, validated against the catalog; returns the resolved list. */
  async update(
    user: AuthenticatedUser,
    input: UpdateBusinessVariables,
  ): Promise<BusinessVariable[]> {
    await this.prisma.$transaction(async (tx) => {
      for (const v of input.values) {
        const def = findBusinessVariable(v.key);
        if (!def) {
          throw new BadRequestException(`Unknown business variable: ${v.key}`);
        }
        let role: OperatorRole | null = null;
        if (def.roleScoped) {
          if (!v.operatorRole) {
            throw new BadRequestException(
              `${def.key} is role-scoped — an operator role is required`,
            );
          }
          role = v.operatorRole;
        } else if (v.operatorRole) {
          throw new BadRequestException(`${def.key} is not role-scoped`);
        }
        if (!isValidBusinessVariableValue(def.type, v.value)) {
          throw new BadRequestException(
            `Invalid value for ${def.key} (${def.type}): ${v.value}`,
          );
        }
        // Numeric values stored canonically (drop trailing zeros); TIME as-is.
        const value = def.type === "TIME" ? v.value : normalizeNumeric(v.value);

        // No upsert: a compound unique containing a NULL role isn't addressable
        // via Prisma's unique where, so find-then-write.
        const existing = await tx.businessVariableValue.findFirst({
          where: { tenantId: user.tenantId, key: def.key, operatorRole: role },
        });
        if (existing) {
          await tx.businessVariableValue.update({
            where: { id: existing.id },
            data: { value },
          });
        } else {
          await tx.businessVariableValue.create({
            data: { tenantId: user.tenantId, key: def.key, operatorRole: role, value },
          });
        }
      }
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "BusinessVariable",
        entityId: user.tenantId,
        action: "UPDATE",
        after: { values: input.values },
      });
    });
    return this.list(user.tenantId);
  }
}
