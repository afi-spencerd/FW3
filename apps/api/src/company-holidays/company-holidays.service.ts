import { Injectable, NotFoundException } from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CompanyHoliday,
  type CreateCompanyHoliday,
  type HolidayRuleType,
  MONTH_LABELS,
  type UpdateCompanyHoliday,
  WEEKDAY_LABELS,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

type HolidayRow = Awaited<
  ReturnType<PrismaService["companyHoliday"]["findFirstOrThrow"]>
>;

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** The date a recurrence rule lands on in a given year, or null if it doesn't exist. */
function resolveForYear(row: HolidayRow, year: number): Date | null {
  if (row.ruleType === "FIXED" && row.month != null && row.day != null) {
    const d = new Date(Date.UTC(year, row.month - 1, row.day));
    return d.getUTCMonth() === row.month - 1 ? d : null; // reject e.g. Feb 30
  }
  if (
    row.ruleType === "NTH_WEEKDAY" &&
    row.month != null &&
    row.weekday != null &&
    row.nth != null
  ) {
    const month0 = row.month - 1;
    if (row.nth === -1) {
      const last = new Date(Date.UTC(year, month0 + 1, 0)); // last day of month
      const diff = (last.getUTCDay() - row.weekday + 7) % 7;
      return new Date(Date.UTC(year, month0, last.getUTCDate() - diff));
    }
    const first = new Date(Date.UTC(year, month0, 1));
    const offset = (row.weekday - first.getUTCDay() + 7) % 7;
    const d = new Date(Date.UTC(year, month0, 1 + offset + (row.nth - 1) * 7));
    return d.getUTCMonth() === month0 ? d : null; // e.g. no 5th Monday
  }
  return null;
}

@Injectable()
export class CompanyHolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<CompanyHoliday[]> {
    const rows = await this.prisma.companyHoliday.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    user: AuthenticatedUser,
    input: CreateCompanyHoliday,
  ): Promise<CompanyHoliday> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.companyHoliday.create({
        data: {
          tenantId: user.tenantId,
          name: input.name,
          ruleType: input.ruleType,
          month: input.month ?? null,
          day: input.day ?? null,
          weekday: input.weekday ?? null,
          nth: input.nth ?? null,
          date: input.date ? new Date(`${input.date}T00:00:00.000Z`) : null,
          active: input.active,
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CompanyHoliday",
        entityId: created.id,
        action: "CREATE",
        after: input,
      });
      return created;
    });
    return this.toDto(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCompanyHoliday,
  ): Promise<CompanyHoliday> {
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyHoliday.findFirst({
        where: { id, tenantId: user.tenantId },
      });
      if (!existing) throw new NotFoundException("Holiday not found");
      const updated = await tx.companyHoliday.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.active === undefined ? {} : { active: input.active }),
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CompanyHoliday",
        entityId: id,
        action: "UPDATE",
        after: input,
      });
      return updated;
    });
    return this.toDto(row);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyHoliday.findFirst({
        where: { id, tenantId: user.tenantId },
      });
      if (!existing) throw new NotFoundException("Holiday not found");
      await tx.companyHoliday.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CompanyHoliday",
        entityId: id,
        action: "DELETE",
        before: { name: existing.name, ruleType: existing.ruleType },
      });
    });
  }

  private describe(row: HolidayRow): string {
    if (row.ruleType === "FIXED" && row.month != null && row.day != null) {
      return `${MONTH_LABELS[row.month - 1]} ${row.day} (every year)`;
    }
    if (
      row.ruleType === "NTH_WEEKDAY" &&
      row.month != null &&
      row.weekday != null &&
      row.nth != null
    ) {
      const which = row.nth === -1 ? "Last" : ordinal(row.nth);
      return `${which} ${WEEKDAY_LABELS[row.weekday]} of ${MONTH_LABELS[row.month - 1]}`;
    }
    if (row.ruleType === "EXPLICIT" && row.date) {
      return `${fmt(row.date)} (one-off)`;
    }
    return row.ruleType;
  }

  private upcoming(row: HolidayRow): string | null {
    if (row.ruleType === "EXPLICIT") return row.date ? fmt(row.date) : null;
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const y = today.getUTCFullYear();
    for (const year of [y, y + 1]) {
      const d = resolveForYear(row, year);
      if (d && d >= today) return fmt(d);
    }
    const d = resolveForYear(row, y);
    return d ? fmt(d) : null;
  }

  private toDto(row: HolidayRow): CompanyHoliday {
    return {
      id: row.id,
      name: row.name,
      ruleType: row.ruleType as HolidayRuleType,
      month: row.month,
      day: row.day,
      weekday: row.weekday,
      nth: row.nth,
      date: row.date ? fmt(row.date) : null,
      active: row.active,
      description: this.describe(row),
      upcomingDate: this.upcoming(row),
    };
  }
}
