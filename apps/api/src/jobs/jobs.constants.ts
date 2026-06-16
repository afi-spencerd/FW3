/** Queue name + DI token for the QuickBooks sync queue. */
export const QB_SYNC_QUEUE_NAME = "qb-sync";
export const QB_SYNC_QUEUE = "QB_SYNC_QUEUE";

export interface QbSyncJobData {
  tenantId: string;
}
