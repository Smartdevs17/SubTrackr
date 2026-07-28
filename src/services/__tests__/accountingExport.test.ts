import {
  AccountingFieldMapping,
  buildAccountingExportCsv,
  clear_accounting_export_data,
  export_to_accounting,
  get_export_history,
  get_export_schedules,
  run_due_exports,
  schedule_export,
} from '../accountingExport';
import { BillingCycle, Subscription, SubscriptionCategory } from '../../types/subscription';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach((key) => mockStorage.delete(key));
    return Promise.resolve();
  }),
}));

const fixedNow = Date.UTC(2026, 0, 15);

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_1',
    name: 'Slack',
    description: 'Team chat',
    category: SubscriptionCategory.SOFTWARE,
    price: 12.5,
    currency: 'usd',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.UTC(2026, 1, 1)),
    isActive: true,
    notificationsEnabled: true,
    isCryptoEnabled: false,
    createdAt: new Date(Date.UTC(2025, 11, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

describe('accountingExport', () => {
  beforeEach(async () => {
    mockStorage.clear();
    jest.clearAllMocks();
    await clear_accounting_export_data();
  });

  it('builds QuickBooks CSV for active subscriptions by default', async () => {
    const subscriptions = [
      makeSubscription(),
      makeSubscription({ id: 'sub_2', name: 'Inactive CRM', isActive: false }),
    ];

    const result = await export_to_accounting('merchant-1', 'quickbooks', {
      subscriptions,
      now: fixedNow,
    });

    expect(result.itemCount).toBe(1);
    expect(result.fileName).toBe('merchant-1-quickbooks-subscription-export-2026-01-15.csv');
    expect(result.content).toContain('"Customer","Product/Service","Description"');
    expect(result.content).toContain('"merchant-1","Slack","Team chat","1","12.50","12.50"');
    expect(result.content).not.toContain('Inactive CRM');
  });

  it('builds Xero CSV with custom accounting fields and inactive subscriptions', () => {
    const csv = buildAccountingExportCsv(
      [makeSubscription({ id: 'sub_2', name: 'Stripe', isActive: false })],
      'merchant-2',
      'xero',
      {
        includeInactive: true,
        customFields: {
          accountCode: '401',
          taxType: 'OUTPUT',
          quantity: '2',
        },
      }
    );

    expect(csv).toContain('"ContactName","InvoiceNumber","InvoiceDate","DueDate"');
    expect(csv).toContain('"merchant-2","sub_2","2025-12-01","2026-02-01","Stripe","2"');
    expect(csv).toContain('"401","OUTPUT","USD"');
  });

  it('supports merchant-defined field mappings and transforms', () => {
    const mappings: AccountingFieldMapping[] = [
      { targetField: 'LedgerName', sourceField: 'subscriptionName', transform: 'uppercase' },
      { targetField: 'Category', sourceField: 'category' },
      { targetField: 'CustomAccount', sourceField: 'custom:accountCode', defaultValue: '400' },
    ];

    const csv = buildAccountingExportCsv([makeSubscription()], 'merchant-1', 'quickbooks', {
      fieldMappings: mappings,
      customFields: { accountCode: '455' },
    });

    expect(csv).toBe('"LedgerName","Category","CustomAccount"\n"SLACK","software","455"');
  });

  it('persists export history and runs due scheduled exports', async () => {
    const nextRunAt = fixedNow - 60_000;
    const schedule = await schedule_export({
      merchantId: 'merchant-3',
      format: 'xero',
      frequency: 'weekly',
      includeInactive: true,
      nextRunAt,
      customFields: { accountCode: '410', taxType: 'NONE', quantity: '1' },
    });

    const runs = await run_due_exports([makeSubscription()], fixedNow);
    const history = await get_export_history('merchant-3');
    const schedules = await get_export_schedules();

    expect(runs).toHaveLength(1);
    expect(runs[0]?.schedule.id).toBe(schedule.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.scheduleId).toBe(schedule.id);
    expect(schedules[0]?.lastRunAt).toBe(fixedNow);
    expect(schedules[0]?.nextRunAt).toBeGreaterThan(fixedNow);
  });

  it('exports JSON format with all fields', async () => {
    const result = await export_to_accounting('merchant-4', 'json', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });

    expect(result.mimeType).toBe('application/json');
    expect(result.fileName).toMatch(/\.json$/);
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({
      merchantId: 'merchant-4',
      subscriptionId: 'sub_1',
      subscriptionName: 'Slack',
      transactionType: 'revenue',
      price: 12.5,
    });
  });

  it('filters by date range', () => {
    const inRange = makeSubscription({ nextBillingDate: new Date(Date.UTC(2026, 1, 15)) });
    const outOfRange = makeSubscription({
      id: 'sub_out',
      nextBillingDate: new Date(Date.UTC(2026, 5, 1)),
    });

    const csv = buildAccountingExportCsv([inRange, outOfRange], 'merchant-5', 'csv', {
      includeInactive: true,
      dateFrom: Date.UTC(2026, 0, 1),
      dateTo: Date.UTC(2026, 2, 31),
    });

    expect(csv).toContain('sub_1');
    expect(csv).not.toContain('sub_out');
  });

  it('filters by transaction type', () => {
    const active = makeSubscription({ id: 'active_sub', isActive: true });
    const inactive = makeSubscription({ id: 'inactive_sub', isActive: false });

    const csv = buildAccountingExportCsv([active, inactive], 'merchant-6', 'csv', {
      includeInactive: true,
      transactionTypes: ['revenue'],
    });

    expect(csv).toContain('active_sub');
    expect(csv).not.toContain('inactive_sub');
  });

  it('includes deferred revenue column when requested', () => {
    const csv = buildAccountingExportCsv([makeSubscription()], 'merchant-7', 'csv', {
      includeDeferredRevenue: true,
      deferredRevenueMap: { sub_1: 5.25 },
    });

    expect(csv).toContain('"DeferredRevenue"');
    expect(csv).toContain('"5.25"');
  });

  it('stores content in history for re-download', async () => {
    await export_to_accounting('merchant-8', 'csv', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });

    const history = await get_export_history('merchant-8');
    expect(history[0]?.content).toBeTruthy();
    expect(history[0]?.content).toContain('sub_1');
  });
});
