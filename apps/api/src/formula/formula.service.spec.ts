import type { PrismaService } from "../database/prisma.service";
import type { AuditService } from "../audit/audit.service";
import { FormulaService } from "./formula.service";

function formulaRow(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    tenantId: "t1",
    finishedGoodId: "fg1",
    finishedGood: { sku: "FG-1", name: "Finished 1" },
    name: "Formula 1",
    version: 2,
    notes: null,
    isActive: true,
    _count: { lines: 3 },
    createdAt: new Date("2026-06-25T00:00:00Z"),
    updatedAt: new Date("2026-06-25T00:00:00Z"),
    ...over,
  };
}

describe("FormulaService.listByFinishedGood", () => {
  it("queries by finished good, active-first then newest version, and maps summaries", async () => {
    let captured: { where?: unknown; orderBy?: unknown } = {};
    const prisma = {
      formula: {
        findMany: async (args: { where: unknown; orderBy: unknown }) => {
          captured = args;
          return [formulaRow(), formulaRow({ id: "f2", version: 1, isActive: false })];
        },
      },
    } as unknown as PrismaService;

    const svc = new FormulaService(prisma, {} as unknown as AuditService);
    const result = await svc.listByFinishedGood("t1", "fg1");

    expect(captured.where).toEqual({ tenantId: "t1", finishedGoodId: "fg1" });
    expect(captured.orderBy).toEqual([{ isActive: "desc" }, { version: "desc" }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "f1",
      finishedGoodSku: "FG-1",
      version: 2,
      isActive: true,
      lineCount: 3,
    });
    expect(result[1]).toMatchObject({ id: "f2", version: 1, isActive: false });
  });
});
