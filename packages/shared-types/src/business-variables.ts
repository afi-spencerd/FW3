import { z } from "zod";

/**
 * Business variables — tenant-configurable operational parameters (working hours,
 * production efficiency, expected pours/hour per operator role, …). The *set* of
 * variables is a curated, code-defined catalog (stable keys the app can read);
 * authorized users edit the *values* in the UI. Values are stored as overrides;
 * anything unset falls back to the catalog default.
 */

/** Operator roles a variable's value can be scoped to (not user assignments yet). */
export const OPERATOR_ROLES = ["FLOOR", "LAB"] as const;
export const operatorRoleSchema = z.enum(OPERATOR_ROLES);
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const OPERATOR_ROLE_LABELS: Record<OperatorRole, string> = {
  FLOOR: "Floor",
  LAB: "Lab (small pours)",
};

/** Drives validation, display unit, and formatting of a variable's value. */
export const BUSINESS_VARIABLE_TYPES = [
  "NUMBER",
  "COUNT",
  "PERCENT",
  "DURATION_HOURS",
] as const;
export const businessVariableTypeSchema = z.enum(BUSINESS_VARIABLE_TYPES);
export type BusinessVariableType = (typeof BUSINESS_VARIABLE_TYPES)[number];

/** A non-negative number, up to 4 decimal places (values cross the wire as strings). */
export const businessVariableValueString = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,4})?$/, "must be a non-negative number (max 4 decimals)");

export interface BusinessVariableDef {
  key: string;
  label: string;
  group: string;
  type: BusinessVariableType;
  /** Display unit suffix, e.g. "h", "%", "/hr"; "" for none. */
  unit: string;
  /** When true, the variable holds one value per operator role. */
  roleScoped: boolean;
  /** Default for a non-role-scoped variable (and fallback for role-scoped). */
  defaultValue: string;
  /** Per-role defaults for a role-scoped variable. */
  roleDefaults?: Partial<Record<OperatorRole, string>>;
}

/**
 * The catalog — the single source of truth for which business variables exist.
 * Adding a variable is a code change here; values are edited per tenant in the UI.
 */
export const BUSINESS_VARIABLES = [
  {
    key: "workingHoursPerDay",
    label: "Working hours per day",
    group: "Production",
    type: "DURATION_HOURS",
    unit: "h",
    roleScoped: false,
    defaultValue: "8",
  },
  {
    key: "workingDaysPerWeek",
    label: "Working days per week",
    group: "Production",
    type: "COUNT",
    unit: "days",
    roleScoped: false,
    defaultValue: "5",
  },
  {
    key: "productionEfficiencyPct",
    label: "Production efficiency",
    group: "Production",
    type: "PERCENT",
    unit: "%",
    roleScoped: false,
    defaultValue: "85",
  },
  {
    key: "poursPerHour",
    label: "Expected pours per hour",
    group: "Pours",
    type: "NUMBER",
    unit: "/hr",
    roleScoped: true,
    defaultValue: "12",
    roleDefaults: { FLOOR: "12", LAB: "30" },
  },
] as const satisfies readonly BusinessVariableDef[];

export type BusinessVariableKey = (typeof BUSINESS_VARIABLES)[number]["key"];

/** Look up a catalog definition by key. */
export function findBusinessVariable(key: string): BusinessVariableDef | undefined {
  return BUSINESS_VARIABLES.find((v) => v.key === key);
}

// ---- write + read shapes ----

/** One value override; operatorRole is required iff the variable is role-scoped. */
export const businessVariableValueInputSchema = z.object({
  key: z.string().min(1).max(80),
  operatorRole: operatorRoleSchema.nullish(),
  value: businessVariableValueString,
});
export const updateBusinessVariablesSchema = z.object({
  values: z.array(businessVariableValueInputSchema).min(1),
});

export const businessVariableEntrySchema = z.object({
  /** Null for a non-role-scoped variable; the role for a role-scoped one. */
  operatorRole: operatorRoleSchema.nullable(),
  value: z.string(),
  /** True when the value comes from the catalog default (no stored override). */
  isDefault: z.boolean(),
});

export const businessVariableSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  type: businessVariableTypeSchema,
  unit: z.string(),
  roleScoped: z.boolean(),
  entries: z.array(businessVariableEntrySchema),
});

export type BusinessVariableValueInput = z.infer<typeof businessVariableValueInputSchema>;
export type UpdateBusinessVariables = z.infer<typeof updateBusinessVariablesSchema>;
export type BusinessVariableEntry = z.infer<typeof businessVariableEntrySchema>;
export type BusinessVariable = z.infer<typeof businessVariableSchema>;
