import { InMemoryPlanRepository } from '../PlanRepository';

describe('InMemoryPlanRepository metadata merge', () => {
  beforeEach(() => {
    InMemoryPlanRepository.resetIdCounter();
  });

  it('merges metadata fields on partial update', async () => {
    const repo = new InMemoryPlanRepository();
    const created = await repo.create({
      name: 'Pro',
      price: 20,
      currency: 'USD',
      billingCycle: 'monthly',
      metadata: { cacheTTL: 3600, tier: 'pro' },
    });

    const updated = await repo.update(created.id, {
      metadata: { cacheTTL: 120 },
    });

    expect(updated?.metadata.cacheTTL).toBe(120);
    expect(updated?.metadata.tier).toBe('pro');
  });
});
