import type { PrismaService } from "../database/prisma.service";
import type { QbAgentClient } from "./qb-agent.client";
import { QbSyncService } from "./qb-sync.service";

const dec = (s: string) => ({ toString: () => s });

function itemRow(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    sku: "RM-X",
    name: "Item X",
    qbItemType: "INVENTORY",
    active: true,
    salesPrice: dec("0"),
    standardCost: dec("3"),
    purchaseDescription: null,
    incomeAccount: null,
    cogsAccount: null,
    assetAccount: null,
    qbListId: null,
    ...over,
  };
}

describe("QbSyncService.syncTenant", () => {
  it("links existing-by-name, creates new, skips already-linked", async () => {
    const itemUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const createdItems: string[] = [];

    const rows = [
      itemRow({ id: "linked", sku: "RM-LINKED", qbListId: "QB-OLD" }), // skipped
      itemRow({ id: "match", sku: "RM-MATCH" }), // linked by name
      itemRow({ id: "new", sku: "RM-NEW" }), // created
    ];

    const prisma = {
      inventoryItem: {
        findMany: async () => rows,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          itemUpdates.push({ id: where.id, data });
          return {};
        },
      },
      customer: {
        findMany: async () => [],
        update: async () => ({}),
      },
    } as unknown as PrismaService;

    const agent = {
      isConfigured: () => true,
      listItems: async () => [
        { listId: "QB-MATCH", editSequence: "E1", type: "Inventory", name: "RM-MATCH" },
      ],
      createItem: async (_body: unknown, idemKey: string) => {
        createdItems.push(idemKey);
        return { listId: "QB-NEW", editSequence: "E2", type: "Inventory", name: "RM-NEW" };
      },
      listCustomers: async () => [],
      createCustomer: async () => ({ listId: "x", editSequence: "y", name: "x" }),
    } as unknown as QbAgentClient;

    const svc = new QbSyncService(prisma, agent);
    const result = await svc.syncTenant("t1");

    expect(result.items).toEqual({ created: 1, linked: 1, skipped: 1, failed: 0 });
    // The created item used a deterministic idempotency key.
    expect(createdItems).toEqual(["item:new"]);
    // linked + created rows got their QB linkage written; skipped did not.
    expect(itemUpdates.map((u) => u.id).sort()).toEqual(["match", "new"]);
    const matchUpdate = itemUpdates.find((u) => u.id === "match");
    expect(matchUpdate?.data.qbListId).toBe("QB-MATCH");
    const newUpdate = itemUpdates.find((u) => u.id === "new");
    expect(newUpdate?.data.qbListId).toBe("QB-NEW");
  });

  it("records a failure per entity without aborting the run", async () => {
    const prisma = {
      inventoryItem: {
        findMany: async () => [itemRow({ id: "boom", sku: "RM-BOOM" })],
        update: async () => ({}),
      },
      customer: { findMany: async () => [], update: async () => ({}) },
    } as unknown as PrismaService;

    const agent = {
      isConfigured: () => true,
      listItems: async () => [],
      createItem: async () => {
        throw new Error("422 name too long");
      },
      listCustomers: async () => [],
      createCustomer: async () => ({ listId: "x", editSequence: "y", name: "x" }),
    } as unknown as QbAgentClient;

    const result = await new QbSyncService(prisma, agent).syncTenant("t1");
    expect(result.items.failed).toBe(1);
    expect(result.errors[0]).toContain("RM-BOOM");
  });

  it("throws when the agent is not configured", async () => {
    const agent = { isConfigured: () => false } as unknown as QbAgentClient;
    const svc = new QbSyncService({} as unknown as PrismaService, agent);
    await expect(svc.syncTenant("t1")).rejects.toThrow(/not configured/);
  });
});
