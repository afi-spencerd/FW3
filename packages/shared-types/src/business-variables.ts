import { z } from "zod";
import { customerRatingSchema } from "./sales.js";

/**
 * Business variables — tenant-configurable operational parameters (working hours,
 * production efficiency, expected pours/hour per operator role, …). The *set* of
 * variables is a curated, code-defined catalog (stable keys the app can read);
 * authorized users edit the *values* in the UI. Values are stored as overrides;
 * anything unset falls back to the catalog default.
 */

/** Operator roles a variable's value can be scoped to (not user assignments yet). */
export const OPERATOR_ROLES = ["FLOOR", "LAB", "SAMPLE_LAB"] as const;
export const operatorRoleSchema = z.enum(OPERATOR_ROLES);
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const OPERATOR_ROLE_LABELS: Record<OperatorRole, string> = {
  FLOOR: "Floor",
  LAB: "Lab (small pours)",
  SAMPLE_LAB: "Sample Lab",
};

/** Drives validation, display unit, and formatting of a variable's value. */
export const BUSINESS_VARIABLE_TYPES = [
  "NUMBER",
  "COUNT",
  "PERCENT",
  "DURATION_HOURS",
  "TIME",
] as const;
export const businessVariableTypeSchema = z.enum(BUSINESS_VARIABLE_TYPES);
export type BusinessVariableType = (typeof BUSINESS_VARIABLE_TYPES)[number];

/** A non-negative number, up to 4 decimal places. */
export const NUMERIC_VALUE_RE = /^\d{1,9}(\.\d{1,4})?$/;
export const businessVariableValueString = z
  .string()
  .regex(NUMERIC_VALUE_RE, "must be a non-negative number (max 4 decimals)");
/** A 24-hour clock time, HH:MM. */
export const TIME_VALUE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate a value string against a variable's type (used by API + UI). */
export function isValidBusinessVariableValue(
  type: BusinessVariableType,
  value: string,
): boolean {
  if (type === "TIME") return TIME_VALUE_RE.test(value);
  if (!NUMERIC_VALUE_RE.test(value)) return false;
  if (type === "PERCENT" && Number(value) > 100) return false;
  return true;
}

export interface BusinessVariableDef {
  key: string;
  label: string;
  group: string;
  type: BusinessVariableType;
  /** Display unit suffix, e.g. "h", "%", "/hr"; "" for none. */
  unit: string;
  /** When true, the variable holds one value per operator role. */
  roleScoped: boolean;
  /**
   * When true, the variable holds an editable base value plus optional per
   * customer-rating (A/B/C/D) overrides; a rating without an override (and any
   * unrated customer) falls back to the base. Mutually exclusive with roleScoped.
   */
  ratingScoped?: boolean;
  /** Default for a non-scoped variable (and base/fallback for scoped ones). */
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
    key: "productionCostFactor",
    label: "Production cost factor (overhead multiplier)",
    group: "Production",
    type: "NUMBER",
    unit: "×",
    roleScoped: false,
    defaultValue: "1",
  },
  {
    key: "shiftStart",
    label: "Shift start",
    group: "Shift",
    type: "TIME",
    unit: "",
    roleScoped: false,
    defaultValue: "06:00",
  },
  {
    key: "shiftEnd",
    label: "Shift end",
    group: "Shift",
    type: "TIME",
    unit: "",
    roleScoped: false,
    defaultValue: "14:30",
  },
  {
    key: "profitMarginPct",
    label: "Profit margin",
    group: "Pricing",
    type: "PERCENT",
    unit: "%",
    roleScoped: false,
    ratingScoped: true,
    defaultValue: "30",
  },
  {
    key: "creditCardFeePct",
    label: "Credit card convenience fee",
    group: "Pricing",
    type: "PERCENT",
    unit: "%",
    roleScoped: false,
    defaultValue: "3",
  },
  {
    key: "poursPerHour",
    label: "Expected pours per hour",
    group: "Pours",
    type: "NUMBER",
    unit: "/hr",
    roleScoped: true,
    defaultValue: "12",
    roleDefaults: { FLOOR: "12", LAB: "30", SAMPLE_LAB: "60" },
  },
  {
    key: "smallPoursLabThresholdLb",
    label: "Small-pours lab max pour",
    group: "Pours",
    type: "NUMBER",
    unit: "lb",
    roleScoped: false,
    defaultValue: "2",
  },
  {
    key: "robotPourThresholdLb",
    label: "Robot max pour",
    group: "Pours",
    type: "NUMBER",
    unit: "lb",
    roleScoped: false,
    defaultValue: "2",
  },
] as const satisfies readonly BusinessVariableDef[];

export type BusinessVariableKey = (typeof BUSINESS_VARIABLES)[number]["key"];

/** Look up a catalog definition by key. */
export function findBusinessVariable(key: string): BusinessVariableDef | undefined {
  return BUSINESS_VARIABLES.find((v) => v.key === key);
}

// ---- write + read shapes ----

/**
 * One value override. `operatorRole` is required iff the variable is role-scoped;
 * `customerRating` may be set (or null for the base) iff it is rating-scoped.
 */
export const businessVariableValueInputSchema = z.object({
  key: z.string().min(1).max(80),
  operatorRole: operatorRoleSchema.nullish(),
  customerRating: customerRatingSchema.nullish(),
  // Validated against the variable's type server-side (numeric vs TIME).
  value: z.string().trim().min(1).max(120),
});
export const updateBusinessVariablesSchema = z.object({
  values: z.array(businessVariableValueInputSchema).min(1),
});

export const businessVariableEntrySchema = z.object({
  /** Set only for a role-scoped variable's per-role entries; null otherwise. */
  operatorRole: operatorRoleSchema.nullable(),
  /** Set only for a rating-scoped variable's per-rating entries; null = base. */
  customerRating: customerRatingSchema.nullable(),
  value: z.string(),
  /** True when the value comes from a default/base (no stored override). */
  isDefault: z.boolean(),
});

export const businessVariableSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  type: businessVariableTypeSchema,
  unit: z.string(),
  roleScoped: z.boolean(),
  ratingScoped: z.boolean(),
  entries: z.array(businessVariableEntrySchema),
});

export type BusinessVariableValueInput = z.infer<typeof businessVariableValueInputSchema>;
export type UpdateBusinessVariables = z.infer<typeof updateBusinessVariablesSchema>;
export type BusinessVariableEntry = z.infer<typeof businessVariableEntrySchema>;
export type BusinessVariable = z.infer<typeof businessVariableSchema>;
