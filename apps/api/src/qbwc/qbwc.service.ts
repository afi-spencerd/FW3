import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import {
  buildItemInventoryQueryRequest,
  parseItemInventoryQueryResponse,
  type QbInventoryItem,
} from "./qbxml";

/**
 * QuickBooks Web Connector integration — STUBBED transport.
 *
 * The real implementation hosts a node-soap SOAP service conforming to the QBWC
 * WSDL (authenticate / sendRequestXML / receiveResponseXML / connectionError /
 * getLastError / closeConnection) and drives the qbXML round-trip per tenant.
 * That transport is not wired yet. The qbXML build/parse mapping below is real
 * and unit-tested; only the SOAP/Web Connector plumbing is a stub.
 *
 * Everything QuickBooks-specific stays behind this service — SOAP/qbXML types
 * never leak into the rest of the app.
 */
@Injectable()
export class QbwcService {
  private readonly logger = new Logger(QbwcService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Build the qbXML the Web Connector would send to pull items. */
  buildItemSyncRequest(): string {
    return buildItemInventoryQueryRequest();
  }

  /**
   * Entry point used by the background worker. STUB: in the real flow this opens
   * a QBWC session and the qbXML is exchanged over SOAP. For now it just builds
   * the request and logs intent.
   */
  async requestItemSync(
    tenantId: string,
  ): Promise<{ queued: boolean; requestXml: string }> {
    const requestXml = this.buildItemSyncRequest();
    this.logger.warn(
      `[STUB] QBWC item sync requested for tenant ${tenantId}; SOAP transport not yet implemented`,
    );
    return { queued: true, requestXml };
  }

  /**
   * Map a QuickBooks ItemInventoryQueryRs response to our items. STUB: parsing
   * is real and tested; persisting (upsert with qbListId/qbEditSequence) is not
   * wired yet.
   */
  async applyItemQueryResponse(
    tenantId: string,
    responseXml: string,
  ): Promise<QbInventoryItem[]> {
    const items = parseItemInventoryQueryResponse(responseXml);
    this.logger.warn(
      `[STUB] parsed ${items.length} QB items for tenant ${tenantId}; persistence not yet implemented`,
    );
    return items;
  }
}
