import {
  Chargeback,
  ChargebackAnalytics,
  ChargebackStatus,
  EvidenceItem,
  EVIDENCE_CHECKLIST,
  REASON_CODES,
} from './types';

// In-memory store (replace with DB in production)
const chargebacks = new Map<string, Chargeback>();

function evidenceChecklistFor(reasonCode: string): string[] {
  return EVIDENCE_CHECKLIST[reasonCode] ?? EVIDENCE_CHECKLIST['default'];
}

export class ChargebackService {
  /** Ingest via webhook or manual entry */
  ingest(data: Omit<Chargeback, 'id' | 'evidenceItems' | 'createdAt' | 'updatedAt'>): Chargeback {
    const id = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Auto-populate evidence checklist for reason code
    const checklist = evidenceChecklistFor(data.reasonCode);
    const evidenceItems: EvidenceItem[] = checklist.map((desc, i) => ({
      id: `ev_${id}_${i}`,
      chargebackId: id,
      description: desc,
      autoPopulated: true,
    }));

    const chargeback: Chargeback = {
      ...data,
      id,
      evidenceItems,
      createdAt: now,
      updatedAt: now,
    };

    chargebacks.set(id, chargeback);
    return chargeback;
  }

  get(id: string): Chargeback | undefined {
    return chargebacks.get(id);
  }

  listByMerchant(merchantId: string): Chargeback[] {
    return Array.from(chargebacks.values()).filter((c) => c.merchantId === merchantId);
  }

  updateStatus(id: string, status: ChargebackStatus): Chargeback {
    const cb = chargebacks.get(id);
    if (!cb) throw new Error(`Chargeback ${id} not found`);
    const updated = { ...cb, status, updatedAt: new Date().toISOString() };
    chargebacks.set(id, updated);
    return updated;
  }

  addEvidence(id: string, item: Omit<EvidenceItem, 'id' | 'chargebackId'>): Chargeback {
    const cb = chargebacks.get(id);
    if (!cb) throw new Error(`Chargeback ${id} not found`);
    const evidenceItem: EvidenceItem = {
      ...item,
      id: `ev_${id}_${Date.now()}`,
      chargebackId: id,
    };
    const updated = {
      ...cb,
      evidenceItems: [...cb.evidenceItems, evidenceItem],
      updatedAt: new Date().toISOString(),
    };
    chargebacks.set(id, updated);
    return updated;
  }

  /** Submit evidence to acquirer API (stub) */
  async submitRepresentment(id: string): Promise<{ success: boolean; referenceId: string }> {
    const cb = chargebacks.get(id);
    if (!cb) throw new Error(`Chargeback ${id} not found`);
    // In production: call acquirer REST API with evidence files
    const referenceId = `repr_${id}_${Date.now()}`;
    this.updateStatus(id, 'evidence_submitted');
    return { success: true, referenceId };
  }

  getAnalytics(merchantId: string): ChargebackAnalytics {
    const list = this.listByMerchant(merchantId);
    const won = list.filter((c) => c.status === 'won').length;
    const lost = list.filter((c) => c.status === 'lost').length;
    const resolved = won + lost;

    const byReasonCode: Record<string, number> = {};
    for (const c of list) {
      byReasonCode[c.reasonCode] = (byReasonCode[c.reasonCode] ?? 0) + 1;
    }

    const trendMap = new Map<string, { count: number; won: number }>();
    for (const c of list) {
      const month = c.createdAt.slice(0, 7);
      const entry = trendMap.get(month) ?? { count: 0, won: 0 };
      entry.count += 1;
      if (c.status === 'won') entry.won += 1;
      trendMap.set(month, entry);
    }
    const trendByMonth = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { count, won: w }]) => ({
        month,
        count,
        winRate: count > 0 ? w / count : 0,
      }));

    return {
      totalCount: list.length,
      winCount: won,
      lossCount: lost,
      winRate: resolved > 0 ? won / resolved : 0,
      chargebackRate: list.length > 0 ? list.length / 1000 : 0, // placeholder total txn count
      byReasonCode,
      trendByMonth,
    };
  }

  getReasonCodeLabel(network: string, code: string): string {
    const networkCodes = REASON_CODES[network as keyof typeof REASON_CODES];
    return networkCodes?.[code] ?? code;
  }
}

export const chargebackService = new ChargebackService();
