import { MerchantComplianceRecord, MerchantOnboardingRequest } from './types';
import { MerchantError } from './errors';

export interface MerchantOnboardingService {
  startOnboarding(input: MerchantOnboardingRequest): Promise<MerchantComplianceRecord>;
  submitDocument(merchantId: string, type: string, uri: string): Promise<MerchantComplianceRecord>;
  requestVerification(merchantId: string): Promise<MerchantComplianceRecord>;
  approve(merchantId: string, tier: 'basic' | 'enhanced', notes?: string): Promise<MerchantComplianceRecord>;
  reject(merchantId: string, reason: string): Promise<MerchantComplianceRecord>;
  get(merchantId: string): Promise<MerchantComplianceRecord>;
}

export class InMemoryMerchantOnboardingService implements MerchantOnboardingService {
  private records = new Map<string, MerchantComplianceRecord>();

  async startOnboarding(input: MerchantOnboardingRequest): Promise<MerchantComplianceRecord> {
    const now = new Date().toISOString();
    const record: MerchantComplianceRecord = {
      merchantId: input.merchantId,
      status: 'in_progress',
      tier: 'basic',
      documents: [],
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.merchantId, record);
    return record;
  }

  async submitDocument(merchantId: string, type: string, uri: string): Promise<MerchantComplianceRecord> {
    const rec = await this.get(merchantId);
    rec.documents.push({ type, uri, uploadedAt: new Date().toISOString(), status: 'pending' });
    rec.updatedAt = new Date().toISOString();
    this.records.set(merchantId, rec);
    return rec;
  }

  async requestVerification(merchantId: string): Promise<MerchantComplianceRecord> {
    const rec = await this.get(merchantId);
    if (rec.documents.length === 0) throw MerchantError.invalidState('At least one document required');
    rec.status = 'pending_review';
    rec.updatedAt = new Date().toISOString();
    this.records.set(merchantId, rec);
    return rec;
  }

  async approve(merchantId: string, tier: 'basic' | 'enhanced', notes?: string): Promise<MerchantComplianceRecord> {
    const rec = await this.get(merchantId);
    rec.status = 'verified';
    rec.tier = tier;
    rec.verificationNotes = notes;
    rec.updatedAt = new Date().toISOString();
    this.records.set(merchantId, rec);
    return rec;
  }

  async reject(merchantId: string, reason: string): Promise<MerchantComplianceRecord> {
    const rec = await this.get(merchantId);
    rec.status = 'rejected';
    rec.verificationNotes = reason;
    rec.updatedAt = new Date().toISOString();
    this.records.set(merchantId, rec);
    return rec;
  }

  async get(merchantId: string): Promise<MerchantComplianceRecord> {
    const rec = this.records.get(merchantId);
    if (!rec) throw MerchantError.notFound(merchantId);
    return rec;
  }
}
