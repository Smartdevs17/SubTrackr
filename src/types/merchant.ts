export enum VerificationTier {
  BASIC = 'basic',
  ENHANCED = 'enhanced',
}

export enum OnboardingStep {
  BUSINESS_INFO = 'business_info',
  ID_DOCUMENT = 'id_document',
  BUSINESS_LICENSE = 'business_license',
  REVIEW = 'review',
}

export enum OnboardingStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  PENDING_REVIEW = 'pending_review',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum DocumentType {
  ID_FRONT = 'id_front',
  ID_BACK = 'id_back',
  BUSINESS_LICENSE = 'business_license',
}

export interface MerchantDocument {
  id: string;
  type: DocumentType;
  uri: string;
  uploadedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
}

export interface VerificationResult {
  isVerified: boolean;
  tier: VerificationTier;
  reviewedAt: Date;
  reviewerNotes?: string;
  limits: {
    monthlyVolume: number;
    maxTransactions: number;
  };
}

export interface MerchantOnboarding {
  id: string;
  merchantAddress: string;
  steps: OnboardingStep[];
  currentStep: OnboardingStep;
  status: OnboardingStatus;
  documents: MerchantDocument[];
  verificationResult?: VerificationResult;
  startedAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface MerchantOnboardingFormData {
  businessName: string;
  businessType: string;
  country: string;
  phoneNumber: string;
  email: string;
}