import { BadRequestException, Injectable } from "@nestjs/common";
import {
  type AuthenticatedUser,
  type BusinessVariable,
  type BusinessVariableDef,
  BUSINESS_VARIABLES,
  CUSTOMER_RATINGS,
  type CustomerRating,
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

  /**
   * Resolve a single variable's value for a tenant (override, else catalog
   * default), as a string. Returns null only for an unknown key.
   */
  async getValue(
    tenantId: string,
    key: string,
    operatorRole: OperatorRole | null = null,
    customerRating: CustomerRating | null = null,
  ): Promise<string | null> {
    const def = findBusinessVariable(key);
    if (!def) return null;
    const row = await this.prisma.businessVariableValue.findFirst({
      where: { tenantId, key, operatorRole, customerRating },
    });
    if (row) return row.value;
    if (def.roleScoped && operatorRole) {
      return def.roleDefaults?.[operatorRole] ?? def.defaultValue;
    }
    if (def.ratingScoped && customerRating) {
      // A rating without its own override falls back to the editable base value.
      const base = await this.prisma.businessVariableValue.findFirst({
        where: { tenantId, key, operatorRole: null, customerRating: null },
      });
      return base?.value ?? def.defaultValue;
    }
    return def.defaultValue;
  }

  /** The catalog resolved against this tenant's stored overrides (defaults fill gaps). */
  async list(tenantId: string): Promise<BusinessVariable[]> {
    const rows = await this.prisma.businessVariableValue.findMany({
      where: { tenantId },
    });
    // Key stored overrides by "key|role|rating" ("" for an unset scope slot).
    const stored = new Map(
      rows.map((r) => [
        `${r.key}|${r.operatorRole ?? ""}|${r.customerRating ?? ""}`,
        r.value,
      ]),
    );
    // Numeric values are normalized for display (legacy rows migrated from the
    // old decimal column may carry trailing zeros); TIME values pass through.
    const display = (type: string, raw: string): string =>
      type === "TIME" ? raw : normalizeNumeric(raw);

    return BUSINESS_VARIABLES.map((def: BusinessVariableDef) => {
      const head = {
        key: def.key,
        label: def.label,
        group: def.group,
        type: def.type,
        unit: def.unit,
        roleScoped: def.roleScoped,
        ratingScoped: def.ratingScoped ?? false,
      };
      if (def.roleScoped) {
        const entries = OPERATOR_ROLES.map((role) => {
          const override = stored.get(`${def.key}|${role}|`);
          const fallback = def.roleDefaults?.[role] ?? def.defaultValue;
          return {
            operatorRole: role,
            customerRating: null,
            value: display(def.type, override ?? fallback),
            isDefault: override === undefined,
          };
        });
        return { ...head, entries };
      }
      if (def.ratingScoped) {
        const baseOverride = stored.get(`${def.key}||`);
        const baseValue = baseOverride ?? def.defaultValue;
        const entries = [
          {
            operatorRole: null,
            customerRating: null,
            value: display(def.type, baseValue),
            isDefault: baseOverride === undefined,
          },
          ...CUSTOMER_RATINGS.map((rating) => {
            const override = stored.get(`${def.key}||${rating}`);
            return {
              operatorRole: null,
              customerRating: rating,
              // A rating without its own override shows the base value.
              value: display(def.type, override ?? baseValue),
              isDefault: override === undefined,
            };
          }),
        ];
        return { ...head, entries };
      }
      const override = stored.get(`${def.key}||`);
      return {
        ...head,
        entries: [
          {
            operatorRole: null,
            customerRating: null,
            value: display(def.type, override ?? def.defaultValue),
            isDefault: override === undefined,
          },
        ],
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
        let rating: CustomerRating | null = null;
        if (def.roleScoped) {
          if (!v.operatorRole) {
            throw new BadRequestException(
              `${def.key} is role-scoped — an operator role is required`,
            );
          }
          if (v.customerRating) {
            throw new BadRequestException(`${def.key} is not rating-scoped`);
          }
          role = v.operatorRole;
        } else if (def.ratingScoped) {
          if (v.operatorRole) {
            throw new BadRequestException(`${def.key} is not role-scoped`);
          }
          // customerRating null targets the editable base value.
          rating = v.customerRating ?? null;
        } else {
          if (v.operatorRole) {
            throw new BadRequestException(`${def.key} is not role-scoped`);
          }
          if (v.customerRating) {
            throw new BadRequestException(`${def.key} is not rating-scoped`);
          }
        }
        if (!isValidBusinessVariableValue(def.type, v.value)) {
          throw new BadRequestException(
            `Invalid value for ${def.key} (${def.type}): ${v.value}`,
          );
        }
        // Numeric values stored canonically (drop trailing zeros); TIME as-is.
        const value = def.type === "TIME" ? v.value : normalizeNumeric(v.value);

        // No upsert: a compound unique containing NULL scope columns isn't
        // addressable via Prisma's unique where, so find-then-write.
        const existing = await tx.businessVariableValue.findFirst({
          where: {
            tenantId: user.tenantId,
            key: def.key,
            operatorRole: role,
            customerRating: rating,
          },
        });
        if (existing) {
          await tx.businessVariableValue.update({
            where: { id: existing.id },
            data: { value },
          });
        } else {
          await tx.businessVariableValue.create({
            data: {
              tenantId: user.tenantId,
              key: def.key,
              operatorRole: role,
              customerRating: rating,
              value,
            },
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
