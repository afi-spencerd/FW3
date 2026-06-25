import type { PrismaService } from "../database/prisma.service";
import type { StockService } from "../stock/stock.service";
import { ProductionService } from "./production.service";

const dec = (s: string) => ({ toString: () => s });

function line(over: Record<string, unknown> = {}) {
  return {
    id: "l1",
    componentId: "compA",
    component: { sku: "RM-A", name: "Material A", unitOfMeasure: "LB" },
    requiredQty: dec("10"),
    stagedQty: dec("0"),
    consumedQty: dec("0"),
    sortOrder: 0,
    assignedLocation: "FLOOR",
    ...over,
  };
}

function workOrder(lines: ReturnType<typeof line>[]) {
  return {
    id: "wo1",
    tenantId: "t1",
    workOrderNumber: "WO-1",
    targetItemId: "fg1",
    target: { sku: "FG-1", name: "Finished 1" },
    formulaId: "f1",
    formula: { name: "Formula 1" },
    batchSize: dec("100"),
    batchUnit: "LB",
    outputQty: dec("100"),
    status: "PLANNED",
    notes: null,
    queuePosition: null,
    salesOrderId: null,
    salesOrder: null,
    lines,
    createdAt: new Date("2026-06-25T00:00:00Z"),
    updatedAt: new Date("2026-06-25T00:00:00Z"),
  };
}

describe("ProductionService.getById availability", () => {
  function build(wo: ReturnType<typeof workOrder>) {
    const prisma = {
      productionWorkOrder: { findFirst: async () => wo },
    } as unknown as PrismaService;
    const stock = {
      getStockPositions: async () => [
        { itemId: "compA", status: "INV", quantity: "45.3" },
        { itemId: "compA", status: "WIP", quantity: "12" },
        { itemId: "other", status: "INV", quantity: "99" },
      ],
    } as unknown as StockService;
    const empty = {} as never;
    return new ProductionService(prisma, empty, stock, empty, empty, empty);
  }

  it("attaches INV and WIP availability per line from stock positions", async () => {
    const svc = build(workOrder([line()]));
    const dto = await svc.getById("t1", "wo1");
    expect(dto.lines[0]?.invAvailable).toBe("45.3");
    expect(dto.lines[0]?.wipAvailable).toBe("12");
  });

  it("leaves availability undefined for components with no stock position", async () => {
    const svc = build(workOrder([line({ id: "l2", componentId: "compB" })]));
    const dto = await svc.getById("t1", "wo1");
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0]?.invAvailable).toBeUndefined();
    expect(dto.lines[0]?.wipAvailable).toBeUndefined();
  });
});
