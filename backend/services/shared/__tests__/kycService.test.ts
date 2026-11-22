import { KycService, kycService } from '../kycService';
import {
  VerificationTier,
  DocumentType,
  MerchantOnboardingFormData,
  MerchantDocument,
} from '../../../../src/types/merchant';

describe('KycService', () => {
  const sampleBusinessInfo: MerchantOnboardingFormData = {
    businessName: 'Acme Corp',
    businessType: 'LLC',
    country: 'USA',
    phoneNumber: '+1234567890',
    email: 'merchant@acme.com',
  };

  const sampleDocuments: MerchantDocument[] = [
    {
      id: 'doc-1',
      type: DocumentType.ID_FRONT,
      uri: 'file:///path/id_front.png',
      uploadedAt: new Date(),
      status: 'pending',
    },
    {
      id: 'doc-2',
      type: DocumentType.BUSINESS_LICENSE,
      uri: 'file:///path/license.pdf',
      uploadedAt: new Date(),
      status: 'pending',
    },
  ];

  it('singleton instance should be returned by getInstance', () => {
    const instance1 = KycService.getInstance();
    const instance2 = KycService.getInstance();
    expect(instance1).toBe(instance2);
    expect(kycService).toBe(instance1);
  });

  it('should submit verification request successfully', async () => {
    const request = await kycService.submitVerificationRequest(
      'merchant-101',
      sampleBusinessInfo,
      sampleDocuments
    );

    expect(request).toBeDefined();
    expect(request.merchantId).toBe('merchant-101');
    expect(request.status).toBe('pending');
    expect(request.documents.length).toBe(2);
  });

  it('should throw error when submitting without required fields', async () => {
    await expect(
      kycService.submitVerificationRequest('', sampleBusinessInfo, sampleDocuments)
    ).rejects.toThrow('Merchant ID is required');

    await expect(
      kycService.submitVerificationRequest(
        'merchant-102',
        { ...sampleBusinessInfo, businessName: '' },
        sampleDocuments
      )
    ).rejects.toThrow('Business name and email are required for KYC verification');

    await expect(
      kycService.submitVerificationRequest('merchant-102', sampleBusinessInfo, [])
    ).rejects.toThrow('At least one document is required for KYC verification');
  });

  it('should process verification and calculate ENHANCED tier for business license', async () => {
    await kycService.submitVerificationRequest(
      'merchant-103',
      sampleBusinessInfo,
      sampleDocuments
    );

    const result = await kycService.processVerification('merchant-103');
    expect(result.verificationResult.isVerified).toBe(true);
    expect(result.verificationResult.tier).toBe(VerificationTier.ENHANCED);
    expect(result.verificationResult.limits.monthlyVolume).toBe(1000000);
    expect(result.verificationResult.limits.maxTransactions).toBe(10000);
  });

  it('should process verification and calculate BASIC tier for basic ID', async () => {
    const basicDocs: MerchantDocument[] = [
      {
        id: 'doc-basic',
        type: DocumentType.ID_FRONT,
        uri: 'file:///path/id_front.png',
        uploadedAt: new Date(),
        status: 'pending',
      },
    ];

    await kycService.submitVerificationRequest(
      'merchant-104',
      sampleBusinessInfo,
      basicDocs
    );

    const result = await kycService.processVerification('merchant-104');
    expect(result.verificationResult.tier).toBe(VerificationTier.BASIC);
    expect(result.verificationResult.limits.monthlyVolume).toBe(10000);
  });

  it('should allow admin approval and rejection', async () => {
    await kycService.submitVerificationRequest(
      'merchant-105',
      sampleBusinessInfo,
      sampleDocuments
    );

    const approved = await kycService.approveVerification(
      'merchant-105',
      VerificationTier.ENHANCED,
      'Approved after compliance review'
    );
    expect(approved.isVerified).toBe(true);
    expect(approved.reviewerNotes).toBe('Approved after compliance review');

    const statusAfterApprove = kycService.getVerificationStatus('merchant-105');
    expect(statusAfterApprove?.status).toBe('approved');

    const rejected = await kycService.rejectVerification(
      'merchant-105',
      'Expired ID document'
    );
    expect(rejected.isVerified).toBe(false);
    expect(rejected.limits.monthlyVolume).toBe(0);
  });
});
