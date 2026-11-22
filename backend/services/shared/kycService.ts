/**
 * KYC Verification Service (Shared Backend Service)
 *
 * Provides functions for processing merchant KYC verification requests,
 * validating document uploads, assigning verification tiers, and managing status.
 */

import {
  MerchantDocument,
  MerchantOnboardingFormData,
  VerificationResult,
  VerificationTier,
  OnboardingStatus,
  KycVerificationRequest,
} from '../../../src/types/merchant';

export interface KycVerificationOptions {
  autoApproveBasic?: boolean;
  manualReviewRequired?: boolean;
}

export interface ProcessingResult {
  request: KycVerificationRequest;
  verificationResult: VerificationResult;
  status: OnboardingStatus;
}

export class KycService {
  private static instance: KycService;
  private requests: Map<string, KycVerificationRequest> = new Map();

  private constructor() {}

  public static getInstance(): KycService {
    if (!KycService.instance) {
      KycService.instance = new KycService();
    }
    return KycService.instance;
  }

  /**
   * Submit a new KYC verification request for a merchant.
   */
  public async submitVerificationRequest(
    merchantId: string,
    businessInfo: MerchantOnboardingFormData,
    documents: MerchantDocument[]
  ): Promise<KycVerificationRequest> {
    if (!merchantId) {
      throw new Error('Merchant ID is required');
    }
    if (!businessInfo.businessName || !businessInfo.email) {
      throw new Error('Business name and email are required for KYC verification');
    }
    if (!documents || documents.length === 0) {
      throw new Error('At least one document is required for KYC verification');
    }

    const request: KycVerificationRequest = {
      merchantId,
      documents,
      businessInfo,
      submittedAt: new Date(),
      status: 'pending',
    };

    this.requests.set(merchantId, request);
    return request;
  }

  /**
   * Process a KYC request and calculate the verification tier and volume limits.
   */
  public async processVerification(
    merchantId: string,
    options: KycVerificationOptions = {}
  ): Promise<ProcessingResult> {
    const request = this.requests.get(merchantId);
    if (!request) {
      throw new Error(`No KYC request found for merchant ID: ${merchantId}`);
    }

    const approvedDocs = request.documents.filter((doc) => doc.status !== 'rejected');
    const hasBusinessLicense = approvedDocs.some(
      (doc) => doc.type === 'business_license' || doc.type === 'tax_document'
    );

    // Determine verification tier based on document depth
    const tier = hasBusinessLicense ? VerificationTier.ENHANCED : VerificationTier.BASIC;

    const limits =
      tier === VerificationTier.ENHANCED
        ? { monthlyVolume: 1000000, maxTransactions: 10000 }
        : { monthlyVolume: 10000, maxTransactions: 100 };

    const isVerified = !options.manualReviewRequired && approvedDocs.length >= 1;
    const status = isVerified
      ? OnboardingStatus.VERIFIED
      : OnboardingStatus.PENDING_REVIEW;

    const verificationResult: VerificationResult = {
      isVerified,
      tier,
      reviewedAt: new Date(),
      reviewerNotes: isVerified
        ? `Automated verification completed for tier ${tier}`
        : 'Pending manual compliance review',
      limits,
    };

    request.status = isVerified ? 'approved' : 'in_review';
    this.requests.set(merchantId, request);

    return {
      request,
      verificationResult,
      status,
    };
  }

  /**
   * Admin approve a pending KYC verification request.
   */
  public async approveVerification(
    merchantId: string,
    tier: VerificationTier = VerificationTier.BASIC,
    notes?: string
  ): Promise<VerificationResult> {
    const request = this.requests.get(merchantId);
    if (!request) {
      throw new Error(`No KYC request found for merchant ID: ${merchantId}`);
    }

    request.status = 'approved';
    request.reviewNotes = notes;

    const limits =
      tier === VerificationTier.ENHANCED
        ? { monthlyVolume: 1000000, maxTransactions: 10000 }
        : { monthlyVolume: 10000, maxTransactions: 100 };

    return {
      isVerified: true,
      tier,
      reviewedAt: new Date(),
      reviewerNotes: notes || `Approved at ${tier} tier`,
      limits,
    };
  }

  /**
   * Admin reject a pending KYC verification request.
   */
  public async rejectVerification(
    merchantId: string,
    reason: string
  ): Promise<VerificationResult> {
    const request = this.requests.get(merchantId);
    if (!request) {
      throw new Error(`No KYC request found for merchant ID: ${merchantId}`);
    }

    request.status = 'rejected';
    request.reviewNotes = reason;

    return {
      isVerified: false,
      tier: VerificationTier.BASIC,
      reviewedAt: new Date(),
      reviewerNotes: reason,
      limits: { monthlyVolume: 0, maxTransactions: 0 },
    };
  }

  /**
   * Get the current KYC request status for a merchant.
   */
  public getVerificationStatus(merchantId: string): KycVerificationRequest | undefined {
    return this.requests.get(merchantId);
  }
}

export const kycService = KycService.getInstance();
