/**
 * In-memory repository for SubscriberRecord[], keyed by merchant.
 * Mirrors backend/services/repositories/inMemory.ts's seed/clear test helpers —
 * there is no live database wired up for this analytics module yet.
 */

import type { SubscriberRecord } from '../../../src/types/cohortAnalytics';

export class SubscriberRecordRepository {
  private byMerchant = new Map<string, SubscriberRecord[]>();

  seed(merchantId: string, records: SubscriberRecord[]): void {
    this.byMerchant.set(merchantId, [...records]);
  }

  upsert(record: SubscriberRecord): void {
    const existing = this.byMerchant.get(record.merchantId) ?? [];
    const index = existing.findIndex((r) => r.subscriberId === record.subscriberId);
    if (index >= 0) existing[index] = record;
    else existing.push(record);
    this.byMerchant.set(record.merchantId, existing);
  }

  getByMerchant(merchantId: string): SubscriberRecord[] {
    return [...(this.byMerchant.get(merchantId) ?? [])];
  }

  listMerchants(): string[] {
    return Array.from(this.byMerchant.keys());
  }

  clear(merchantId?: string): void {
    if (merchantId) this.byMerchant.delete(merchantId);
    else this.byMerchant.clear();
  }
}

export const subscriberRecordRepository = new SubscriberRecordRepository();
