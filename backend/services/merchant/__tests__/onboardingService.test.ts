import { InMemoryMerchantOnboardingService } from '../onboardingService';

describe('MerchantOnboardingService', () => {
  it('runs onboarding to verified state', async () => {
    const svc = new InMemoryMerchantOnboardingService();
    await svc.startOnboarding({ merchantId: 'm1', businessName: 'Acme', email: 'a@b.com' });
    await svc.submitDocument('m1', 'id_front', 'file://id.png');
    await svc.requestVerification('m1');
    const approved = await svc.approve('m1', 'enhanced', 'ok');
    expect(approved.status).toBe('verified');
    expect(approved.tier).toBe('enhanced');
  });
});
