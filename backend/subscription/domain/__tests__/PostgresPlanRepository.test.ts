import { PostgresPlanRepository } from '../PostgresPlanRepository';
import type { Pool } from '../../../shared/db/connectionPool';

describe('PostgresPlanRepository', () => {
  it('maps database rows to PlanMetadata', async () => {
    const pool = {
      query: jest.fn(async () => ({
        rows: [
          {
            id: 'plan-1',
            name: 'Starter',
            price: '9.99',
            currency: 'USD',
            billingCycle: 'monthly',
            features: ['a'],
            limits: { maxUsers: 5 },
            metadata: { cacheTTL: 600 },
            isActive: true,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      })),
    } as unknown as Pool;

    const repo = new PostgresPlanRepository(pool);
    const plan = await repo.findById('plan-1');

    expect(plan).toEqual({
      id: 'plan-1',
      name: 'Starter',
      price: 9.99,
      currency: 'USD',
      billingCycle: 'monthly',
      features: ['a'],
      limits: { maxUsers: 5 },
      metadata: { cacheTTL: 600 },
      isActive: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
  });
});
