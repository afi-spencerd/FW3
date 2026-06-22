import { z } from "zod";
import { ifraCategorySchema, prop65StatusSchema } from "./inventory.js";

/**
 * Finished-good regulatory profile. Two sources:
 *  - `derived`: rolled up in-house from the FG's raw-material make-up (computed
 *    live from the active formula, including nested bases) — component CAS list,
 *    Prop65, and an indicative per-IFRA-category concentration limit.
 *  - `formPak`: the persisted FormPak+ snapshot (authoritative finished-product
 *    data we can't compute: flash point, IFRA QRA levels, allergen declaration,
 *    overall compliance), refreshed on demand.
 */

export const COMPLIANCE_STATUSES = [
  "UNKNOWN",
  "COMPLIANT",
  "NON_COMPLIANT",
  "PENDING",
] as const;
export const complianceStatusSchema = z.enum(COMPLIANCE_STATUSES);
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

// ---- Derived (from RM make-up) ----

/** A raw material in the FG with its effective concentration (after roll-up). */
export const fgComponentSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  casNumber: z.string().nullable(),
  /** Effective % of this RM in the finished good (product of percentages). */
  effectivePercent: z.string(),
});

/** Indicative max-in-finished-product per IFRA category, derived from RM limits. */
export const fgIfraDerivedSchema = z.object({
  category: ifraCategorySchema,
  /** min over RMs of (RM category limit ÷ RM effective fraction). */
  maxPercent: z.string(),
  /** The RM that binds this category limit. */
  limitingSku: z.string(),
});

export const fgDerivedSchema = z.object({
  /** True when the FG has an active formula to roll up. */
  hasFormula: z.boolean(),
  formulaName: z.string().nullable(),
  formulaVersion: z.number().int().nullable(),
  components: z.array(fgComponentSchema),
  casList: z.array(z.string()),
  prop65Status: prop65StatusSchema,
  /** RMs that contribute a Prop65 listing (sku + notes). */
  prop65Contributors: z.array(
    z.object({ sku: z.string(), notes: z.string().nullable() }),
  ),
  ifraDerived: z.array(fgIfraDerivedSchema),
});

// ---- FormPak+ snapshot ----

export const formPakIfraLevelSchema = z.object({
  category: ifraCategorySchema,
  maxPercent: z.string(),
});

export const formPakProfileSchema = z.object({
  flashPointC: z.string().nullable(),
  complianceStatus: complianceStatusSchema,
  allergenDeclaration: z.string().nullable(),
  certificateUrl: z.string().nullable(),
  formPakRef: z.string().nullable(),
  ifraLevels: z.array(formPakIfraLevelSchema),
  syncedAt: z.string().datetime().nullable(),
});

export const fgRegulatorySchema = z.object({
  itemId: z.string().uuid(),
  derived: fgDerivedSchema,
  /** Null until first refreshed from FormPak+. */
  formPak: formPakProfileSchema.nullable(),
});

/** Lightweight per-FG row for the finished-goods listing badges. */
export const fgRegulatorySummarySchema = z.object({
  itemId: z.string().uuid(),
  complianceStatus: complianceStatusSchema.nullable(),
  flashPointC: z.string().nullable(),
  syncedAt: z.string().datetime().nullable(),
});

export type FgComponent = z.infer<typeof fgComponentSchema>;
export type FgIfraDerived = z.infer<typeof fgIfraDerivedSchema>;
export type FgDerived = z.infer<typeof fgDerivedSchema>;
export type FormPakIfraLevel = z.infer<typeof formPakIfraLevelSchema>;
export type FormPakProfile = z.infer<typeof formPakProfileSchema>;
export type FgRegulatory = z.infer<typeof fgRegulatorySchema>;
export type FgRegulatorySummary = z.infer<typeof fgRegulatorySummarySchema>;
