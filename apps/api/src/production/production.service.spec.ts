import type { AuditService } from "../audit/audit.service";
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

describe("ProductionService.reassign", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function build(over: { wo?: any; targetLine?: any; hasLineKey?: boolean } = {}) {
    const wo =
      over.wo ??
      ({
        ...workOrder([line()]),
        salesOrderId: "soA",
        salesOrderLineId: "soA-l1",
      } as ReturnType<typeof workOrder> & {
        salesOrderLineId: string | null;
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audited: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any[] = [];
    const tx = {
      productionWorkOrder: {
        findFirst: async () => wo,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        update: async (args: any) => {
          updates.push(args);
          return {};
        },
      },
      salesOrder: {
        findFirst: async () => ({ id: "soB", tenantId: "t1", status: "OPEN" }),
      },
      salesOrderLine: {
        findFirst: async () =>
          over.hasLineKey
            ? over.targetLine
            : { id: "soB-l1", salesOrderId: "soB", itemId: "fg1" },
      },
    };
    const prisma = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: async (fn: any) => fn(tx),
      productionWorkOrder: { findFirst: async () => wo },
    } as unknown as PrismaService;
    const stock = {
      getStockPositions: async () => [],
    } as unknown as StockService;
    const audit = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      record: async (_tx: unknown, entry: any) => {
        audited.push(entry);
      },
    } as unknown as AuditService;
    const empty = {} as never;
    const svc = new ProductionService(prisma, audit, stock, empty, empty, empty);
    return { svc, audited, updates };
  }

  const actor = { id: "user-1", tenantId: "t1" } as never;

  it("moves the work order to the new line and audits actor + before/after", async () => {
    const { svc, audited, updates } = build();
    await svc.reassign(actor, "wo1", {
      salesOrderId: "soB",
      salesOrderLineId: "soB-l1",
    });
    expect(updates[0].data).toEqual({
      salesOrderId: "soB",
      salesOrderLineId: "soB-l1",
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      actorId: "user-1",
      entityType: "ProductionWorkOrder",
      entityId: "wo1",
      action: "UPDATE",
      before: { salesOrderId: "soA", salesOrderLineId: "soA-l1" },
      after: { salesOrderId: "soB", salesOrderLineId: "soB-l1" },
    });
  });

  it("rejects a target line that orders a different item", async () => {
    const { svc } = build({
      hasLineKey: true,
      targetLine: { id: "soB-l9", salesOrderId: "soB", itemId: "OTHER" },
    });
    await expect(
      svc.reassign(actor, "wo1", {
        salesOrderId: "soB",
        salesOrderLineId: "soB-l9",
      }),
    ).rejects.toThrow(/different item/);
  });

  it("rejects reassigning a cancelled work order", async () => {
    const { svc } = build({
      wo: {
        ...workOrder([line()]),
        status: "CANCELLED",
        salesOrderId: "soA",
        salesOrderLineId: null,
      },
    });
    await expect(
      svc.reassign(actor, "wo1", { salesOrderId: "soB" }),
    ).rejects.toThrow(/cancelled work order/i);
  });
});
