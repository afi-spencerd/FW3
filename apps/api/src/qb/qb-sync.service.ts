import { Injectable, Logger } from "@nestjs/common";
import type { QbAgentHealth, QbSyncResult, QbSyncTally } from "@fw3/shared-types";
import { PrismaService } from "../database/prisma.service";
import { QbAgentClient } from "./qb-agent.client";
import { customerToCreateRequest, itemToCreateRequest } from "./qb-map";

/**
 * Pushes our item masters and customers into QuickBooks via the agent. The sync
 * is create-only (the agent exposes no update/Mod): an entity already linked
 * (qbListId set) is skipped; an unlinked entity is linked to a matching QB
 * record by name, or created. Idempotency-Key = our row id, so replays are safe.
 */
@Injectable()
export class QbSyncService {
  private readonly logger = new Logger(QbSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: QbAgentClient,
  ) {}

  async health(): Promise<QbAgentHealth> {
    if (!this.agent.isConfigured()) {
      return {
        configured: false,
        qbReachable: false,
        companyFileOpen: false,
        companyFilePath: null,
        qbVersion: null,
        agentVersion: null,
        mode: null,
        detail: "QB agent not configured (QB_AGENT_URL / QB_AGENT_API_KEY)",
      };
    }
    const h = await this.agent.health();
    return {
      configured: true,
      qbReachable: h.qbReachable,
      companyFileOpen: h.companyFileOpen,
      companyFilePath: h.companyFilePath,
      qbVersion: h.qbVersion,
      agentVersion: h.agentVersion,
      mode: h.mode,
      detail: h.detail,
    };
  }

  async syncTenant(tenantId: string): Promise<QbSyncResult> {
    if (!this.agent.isConfigured()) {
      throw new Error(
        "QuickBooks agent is not configured (set QB_AGENT_URL and QB_AGENT_API_KEY)",
      );
    }
    const items = await this.syncItems(tenantId);
    const customers = await this.syncCustomers(tenantId);
    const result: QbSyncResult = {
      items: items.tally,
      customers: customers.tally,
      errors: [...items.errors, ...customers.errors],
    };
    this.logger.log(
      `QB sync for tenant ${tenantId}: items ${JSON.stringify(items.tally)}, customers ${JSON.stringify(customers.tally)}`,
    );
    return result;
  }

  private async syncItems(
    tenantId: string,
  ): Promise<{ tally: QbSyncTally; errors: string[] }> {
    const tally = emptyTally();
    const errors: string[] = [];
    const agentItems = await this.agent.listItems();
    const byName = new Map(agentItems.map((i) => [i.name.toLowerCase(), i]));

    const rows = await this.prisma.inventoryItem.findMany({
      where: { tenantId, active: true },
    });
    for (const row of rows) {
      if (row.qbListId) {
        tally.skipped++;
        continue;
      }
      try {
        const match = byName.get(row.sku.toLowerCase());
        let listId: string;
        let editSequence: string;
        if (match) {
          ({ listId, editSequence } = match);
          tally.linked++;
        } else {
          const dto = await this.agent.createItem(
            itemToCreateRequest({
              sku: row.sku,
              name: row.name,
              qbItemType: row.qbItemType,
              active: row.active,
              salesPrice: row.salesPrice.toString(),
              standardCost: row.standardCost.toString(),
              purchaseDescription: row.purchaseDescription,
              incomeAccount: row.incomeAccount,
              cogsAccount: row.cogsAccount,
              assetAccount: row.assetAccount,
            }),
            `item:${row.id}`,
          );
          ({ listId, editSequence } = dto);
          tally.created++;
        }
        await this.prisma.inventoryItem.update({
          where: { id: row.id },
          data: { qbListId: listId, qbEditSequence: editSequence, qbSyncedAt: new Date() },
        });
      } catch (err) {
        tally.failed++;
        errors.push(`item ${row.sku}: ${message(err)}`);
      }
    }
    return { tally, errors };
  }

  private async syncCustomers(
    tenantId: string,
  ): Promise<{ tally: QbSyncTally; errors: string[] }> {
    const tally = emptyTally();
    const errors: string[] = [];
    const agentCustomers = await this.agent.listCustomers();
    const byName = new Map(agentCustomers.map((c) => [c.name.toLowerCase(), c]));

    const rows = await this.prisma.customer.findMany({
      where: { tenantId, isActive: true },
      include: { contacts: { orderBy: { sortOrder: "asc" } } },
    });
    for (const row of rows) {
      if (row.qbListId) {
        tally.skipped++;
        continue;
      }
      try {
        const match = byName.get(row.name.toLowerCase());
        let listId: string;
        let editSequence: string;
        if (match) {
          ({ listId, editSequence } = match);
          tally.linked++;
        } else {
          const dto = await this.agent.createCustomer(
            customerToCreateRequest({
              name: row.name,
              phone: row.phone,
              email: row.email,
              contacts: row.contacts.map((c) => ({
                name: c.name,
                phone: c.phone,
                email: c.email,
                isPrimary: c.isPrimary,
              })),
            }),
            `customer:${row.id}`,
          );
          ({ listId, editSequence } = dto);
          tally.created++;
        }
        await this.prisma.customer.update({
          where: { id: row.id },
          data: { qbListId: listId, qbEditSequence: editSequence, qbSyncedAt: new Date() },
        });
      } catch (err) {
        tally.failed++;
        errors.push(`customer ${row.name}: ${message(err)}`);
      }
    }
    return { tally, errors };
  }
}

function emptyTally(): QbSyncTally {
  return { created: 0, linked: 0, skipped: 0, failed: 0 };
}
function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
