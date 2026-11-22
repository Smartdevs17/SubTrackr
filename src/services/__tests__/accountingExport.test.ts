import {
  ACCOUNTING_EXPORT_JSON_SCHEMA,
  AccountingFieldMapping,
  buildAccountingExportCsv,
  clear_accounting_export_data,
  delete_export_schedule,
  export_to_accounting,
  get_accounting_json_schema,
  get_export_analytics,
  get_export_history,
  get_export_schedules,
  record_export_download,
  run_due_exports,
  run_export_schedule,
  schedule_export,
  toggle_export_schedule,
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

  // ── PDF export ──────────────────────────────────────────────────────────────

  it('exports PDF format and returns application/pdf MIME type', async () => {
    const result = await export_to_accounting('merchant-pdf', 'pdf', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });

    expect(result.mimeType).toBe('application/pdf');
    expect(result.fileName).toMatch(/\.pdf$/);
    expect(result.content).toContain('%PDF-1.4');
    expect(result.content).toContain('merchant-pdf');
    expect(result.content).toContain('Slack');
    expect(result.content).toContain('%%EOF');
  });

  it('PDF export includes inactive subscriptions when requested', async () => {
    const active = makeSubscription({ id: 'a1', name: 'ActiveSub', isActive: true });
    const inactive = makeSubscription({ id: 'a2', name: 'InactiveSub', isActive: false });

    const withInactive = await export_to_accounting('merchant-pdf2', 'pdf', {
      subscriptions: [active, inactive],
      includeInactive: true,
      now: fixedNow,
    });
    expect(withInactive.itemCount).toBe(2);
    expect(withInactive.content).toContain('InactiveSub');

    const withoutInactive = await export_to_accounting('merchant-pdf3', 'pdf', {
      subscriptions: [active, inactive],
      includeInactive: false,
      now: fixedNow,
    });
    expect(withoutInactive.itemCount).toBe(1);
    expect(withoutInactive.content).not.toContain('InactiveSub');
  });

  // ── JSON schema export ──────────────────────────────────────────────────────

  it('wraps JSON export with schema envelope when includeSchema is true', async () => {
    const result = await export_to_accounting('merchant-schema', 'json', {
      subscriptions: [makeSubscription()],
      includeSchema: true,
      now: fixedNow,
    });

    const parsed = JSON.parse(result.content);
    expect(parsed.$schema).toBe('https://subtrackr.app/schemas/accounting-export.json');
    expect(parsed.schemaVersion).toBe('1.0.0');
    expect(parsed.merchantId).toBe('merchant-schema');
    expect(parsed.recordCount).toBe(1);
    expect(Array.isArray(parsed.records)).toBe(true);
    expect(parsed.records[0].subscriptionId).toBe('sub_1');
  });

  it('returns bare JSON array when includeSchema is false (default)', async () => {
    const result = await export_to_accounting('merchant-json2', 'json', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });

    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].subscriptionId).toBe('sub_1');
  });

  it('get_accounting_json_schema returns the schema constant', () => {
    const schema = get_accounting_json_schema();
    expect(schema).toBe(ACCOUNTING_EXPORT_JSON_SCHEMA);
    expect(schema.$id).toMatch(/subtrackr\.app/);
    expect(schema.type).toBe('object');
    expect(schema.properties.records.type).toBe('array');
  });

  // ── Schedule management ─────────────────────────────────────────────────────

  it('toggle_export_schedule enables and disables a schedule', async () => {
    const sched = await schedule_export({
      merchantId: 'merchant-toggle',
      format: 'csv',
      frequency: 'weekly',
    });

    const paused = await toggle_export_schedule(sched.id, false);
    expect(paused?.enabled).toBe(false);

    const resumed = await toggle_export_schedule(sched.id, true);
    expect(resumed?.enabled).toBe(true);
  });

  it('toggle_export_schedule returns null for unknown id', async () => {
    const result = await toggle_export_schedule('nonexistent_id', true);
    expect(result).toBeNull();
  });

  it('delete_export_schedule removes the schedule', async () => {
    const sched = await schedule_export({
      merchantId: 'merchant-delete',
      format: 'csv',
      frequency: 'daily',
    });

    await delete_export_schedule(sched.id);
    const schedules = await get_export_schedules();
    expect(schedules.find((s) => s.id === sched.id)).toBeUndefined();
  });

  it('run_export_schedule executes and advances nextRunAt', async () => {
    const sched = await schedule_export({
      merchantId: 'merchant-run',
      format: 'quickbooks',
      frequency: 'monthly',
    });

    const run = await run_export_schedule(sched.id, [makeSubscription()], fixedNow);
    expect(run).not.toBeNull();
    expect(run!.schedule.id).toBe(sched.id);
    expect(run!.result.itemCount).toBe(1);

    const schedules = await get_export_schedules();
    const updated = schedules.find((s) => s.id === sched.id)!;
    expect(updated.lastRunAt).toBe(fixedNow);
    expect(updated.nextRunAt).toBeGreaterThan(fixedNow);
  });

  it('run_export_schedule returns null for unknown id', async () => {
    const result = await run_export_schedule('unknown_id', [makeSubscription()]);
    expect(result).toBeNull();
  });

  // ── Export analytics ────────────────────────────────────────────────────────

  it('get_export_analytics aggregates export counts and format breakdown', async () => {
    await export_to_accounting('merchant-analytics', 'csv', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });
    await export_to_accounting('merchant-analytics', 'pdf', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });
    await export_to_accounting('merchant-analytics', 'json', {
      subscriptions: [makeSubscription(), makeSubscription({ id: 'sub_2' })],
      now: fixedNow,
    });

    const analytics = await get_export_analytics('merchant-analytics');
    expect(analytics.totalExports).toBe(3);
    expect(analytics.successCount).toBe(3);
    expect(analytics.failedCount).toBe(0);
    expect(analytics.totalItemsExported).toBe(4); // 1 + 1 + 2
    expect(analytics.formatBreakdown.csv).toBe(1);
    expect(analytics.formatBreakdown.pdf).toBe(1);
    expect(analytics.formatBreakdown.json).toBe(1);
  });

  it('record_export_download increments download count', async () => {
    const result = await export_to_accounting('merchant-dl', 'csv', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });

    const exportId = result.exportId;
    expect(result.historyEntry.downloadCount).toBe(0);

    const updated1 = await record_export_download(exportId);
    expect(updated1?.downloadCount).toBe(1);

    const updated2 = await record_export_download(exportId);
    expect(updated2?.downloadCount).toBe(2);
    expect(updated2?.lastDownloadedAt).toBeGreaterThan(0);
  });

  it('record_export_download returns null for unknown id', async () => {
    const result = await record_export_download('unknown_export_id');
    expect(result).toBeNull();
  });

  it('get_export_analytics tracks downloads', async () => {
    const result = await export_to_accounting('merchant-dl-analytics', 'csv', {
      subscriptions: [makeSubscription()],
      now: fixedNow,
    });

    await record_export_download(result.exportId);
    await record_export_download(result.exportId);

    const analytics = await get_export_analytics('merchant-dl-analytics');
    expect(analytics.totalDownloads).toBe(2);
  });
});
