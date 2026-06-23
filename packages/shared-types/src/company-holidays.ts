import { z } from "zod";

/**
 * Company holidays (closure calendar) — recurring or one-off dates the business
 * is closed, used by working-day / capacity math. Recurrence is rule-based so a
 * single entry covers every year:
 *  - FIXED: same month/day every year (e.g. Jul 4).
 *  - NTH_WEEKDAY: the Nth weekday of a month (e.g. 4th Thursday of November);
 *    nth = -1 means the last such weekday.
 *  - EXPLICIT: a specific one-off date (e.g. a movable feast entered manually).
 */

export const HOLIDAY_RULE_TYPES = ["FIXED", "NTH_WEEKDAY", "EXPLICIT"] as const;
export const holidayRuleTypeSchema = z.enum(HOLIDAY_RULE_TYPES);
export type HolidayRuleType = (typeof HOLIDAY_RULE_TYPES)[number];

/** 0 = Sunday … 6 = Saturday (matches JS Date.getDay()). */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const createCompanyHolidaySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    ruleType: holidayRuleTypeSchema,
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    /** 1..5, or -1 for "last". */
    nth: z.number().int().min(-1).max(5).optional(),
    date: isoDate.optional(),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.ruleType === "FIXED" && (v.month == null || v.day == null)) {
      ctx.addIssue({ code: "custom", message: "FIXED needs month and day", path: ["month"] });
    }
    if (
      v.ruleType === "NTH_WEEKDAY" &&
      (v.month == null || v.weekday == null || v.nth == null || v.nth === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "NTH_WEEKDAY needs month, weekday, and nth (1-5 or -1)",
        path: ["nth"],
      });
    }
    if (v.ruleType === "EXPLICIT" && !v.date) {
      ctx.addIssue({ code: "custom", message: "EXPLICIT needs a date", path: ["date"] });
    }
  });

/** Light edit: rename / activate-deactivate (rule fields are fixed; re-add to change). */
export const updateCompanyHolidaySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
});

export const companyHolidaySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ruleType: holidayRuleTypeSchema,
  month: z.number().int().nullable(),
  day: z.number().int().nullable(),
  weekday: z.number().int().nullable(),
  nth: z.number().int().nullable(),
  date: z.string().nullable(),
  active: z.boolean(),
  /** Human-readable rule, e.g. "4th Thursday of November". */
  description: z.string(),
  /** Next occurrence as YYYY-MM-DD (this year or next); null if unresolvable/past one-off. */
  upcomingDate: z.string().nullable(),
});

export type CreateCompanyHoliday = z.infer<typeof createCompanyHolidaySchema>;
export type UpdateCompanyHoliday = z.infer<typeof updateCompanyHolidaySchema>;
export type CompanyHoliday = z.infer<typeof companyHolidaySchema>;
