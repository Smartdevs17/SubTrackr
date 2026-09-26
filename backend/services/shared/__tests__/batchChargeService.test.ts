import { BatchChargeService, BatchChargeCandidate } from '../batchChargeService';
import { MonitoringService } from '../monitoring';

describe('BatchChargeService', () => {
  let service: BatchChargeService;
  let monitoring: MonitoringService;

  beforeEach(() => {
    service = new BatchChargeService({ checkIntervalMs: 10 });
    monitoring = new MonitoringService();
  });

  it('selects subscriptions due today and overdue', () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const subs: BatchChargeCandidate[] = [
      { subscriptionId: 'today', amount: 10, nextBillingDate: now, isActive: true },
      { subscriptionId: 'overdue', amount: 20, nextBillingDate: yesterday, isActive: true },
      { subscriptionId: 'future', amount: 30, nextBillingDate: tomorrow, isActive: true },
    ];

    expect(BatchChargeService.selectDueToday(subs).map((s) => s.subscriptionId)).toEqual(['today']);
    expect(BatchChargeService.selectOverdue(subs).map((s) => s.subscriptionId)).toEqual(['overdue']);
  });

  it('calculates batch gas savings', () => {
    const savings = service.getSavings(10);
    expect(savings.batchGas).toBe(1_050_000);
    expect(savings.singleTxGas).toBe(1_500_000);
    expect(savings.saved).toBe(450_000);
    expect(savings.percent).toBe(30);
  });

  it('executes batch charge with partial success and records transaction events', async () => {
    const now = new Date();
    const subs: BatchChargeCandidate[] = [
      { subscriptionId: 'good', amount: 10, nextBillingDate: now, isActive: true },
      { subscriptionId: 'bad', amount: 20, nextBillingDate: now, isActive: true },
    ];

    const result = await service.executeBatchCharge(
      subs,
      async (id) => id === 'good',
      monitoring,
      { atomic: false },
    );

    expect(result.totalItems).toBe(2);
    expect(result.successfulItems).toBe(1);
    expect(result.failedItems).toBe(1);
    expect(result.state).toBe('partial');
    expect(monitoring.getDashboard().totalTransactions).toBe(2);
    expect(monitoring.getDashboard().failureCount).toBe(1);
  });

  it('stops schedule when requested', () => {
    service.scheduleBatchCharge('0 0 * * *', async () => [], async () => true, monitoring);
    service.stopSchedule();
    expect((service as any).intervalHandle).toBeNull();
  });
});
