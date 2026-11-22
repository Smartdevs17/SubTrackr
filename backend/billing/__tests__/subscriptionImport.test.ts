import { SubscriptionImportService } from '../domain/SubscriptionImportService';
import type { SubscriptionImportStore } from '../domain/SubscriptionImportService';

function createStore(): SubscriptionImportStore & { rows: Array<{ id: string; email: string; planId: string }> } {
  const rows: Array<{ id: string; email: string; planId: string; externalId?: string }> = [];
  return {
    rows,
    async findByEmail(email: string) {
      const found = rows.find((r) => r.email === email);
      return found ? { id: found.id } : null;
    },
    async findByExternalId(externalId: string) {
      const found = rows.find((r) => r.externalId === externalId);
      return found ? { id: found.id } : null;
    },
    async create(data) {
      rows.push(data as any);
      return { id: data.id };
    },
  };
}

describe('SubscriptionImportService', () => {
  it('imports valid rows', async () => {
    const store = createStore();
    const service = new SubscriptionImportService(store);
    const result = await service.importRows([
      { email: 'a@example.com', planId: 'pro' },
      { email: 'b@example.com', planId: 'basic' },
    ]);
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
    expect(store.rows).length(2);
  });

  it('skips duplicate emails within payload', async () => {
    const store = createStore();
    const service = new SubscriptionImportService(store);
    const result = await service.importRows([
      { email: 'a@example.com', planId: 'pro' },
      { email: 'A@example.com', planId: 'pro' },
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('skips duplicates against existing store', async () => {
    const store = createStore();
    await store.create({ id: '1', email: 'a@example.com', planId: 'pro' });
    const service = new SubscriptionImportService(store);
    const result = await service.importRows([
      { email: 'a@example.com', planId: 'pro' },
      { email: 'c@example.com', planId: 'basic' },
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('reports invalid rows', async () => {
    const store = createStore();
    const service = new SubscriptionImportService(store);
    const result = await service.importRows([
      { email: 'not-an-email', planId: 'pro' },
      { email: 'a@example.com', planId: '' },
    ]);
    expect(result.failed).toBe(2);
    expect(result.errors).length(2);
  });

  it('skips duplicate externalIds', async () => {
    const store = createStore();
    const service = new SubscriptionImportService(store);
    const result = await service.importRows([
      { email: 'a@example.com', planId: 'pro', externalId: 'sub_1' },
      { email: 'b@example.com', planId: 'pro', externalId: 'sub_1' },
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
