export interface MerchantOnboardingRequest {
  merchantId: string;
  businessName: string;
  businessType?: string;
  country?: string;
  email: string;
  phoneNumber?: string;
}

export type MerchantComplianceStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending_review'
  | 'verified'
  | 'rejected';

export interface MerchantComplianceRecord {
  merchantId: string;
  status: MerchantComplianceStatus;
  tier: 'basic' | 'enhanced';
  documents: Array<{ type: string; uri: string; uploadedAt: string; status: string }>;
  verificationNotes?: string;
  createdAt: string;
  updatedAt: string;
}
