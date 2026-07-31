import { useMeteringStore, bucketStart, billableUnits } from '../meteringStore';

let clock = 1000;
const reset = () => useMeteringStore.setState({ meters: {}, alerts: [], now: () => clock });

beforeEach(() => {
  clock = 1000;
  reset();
});

const s = () => useMeteringStore.getState();

describe('metering helpers', () => {
  it('computes bucket starts', () => {
    expect(bucketStart(7300, 3600)).toBe(7200);
    expect(bucketStart(3600, 3600)).toBe(3600);
  });
  it('computes billable units over the free tier', () => {
    expect(billableUnits(150, 100)).toBe(50);
    expect(billableUnits(80, 100)).toBe(0);
  });
});

describe('useMeteringStore', () => {
  it('ingests usage and tracks the total', () => {
    s().registerMeter('1', 'api_calls', { unitPrice: 2, includedUnits: 0 });
    s().recordUsage('1', 'api_calls', 10);
    s().recordUsage('1', 'api_calls', 5);
    expect(s().getUsageTotal('1', 'api_calls')).toBe(15);
  });

  it('ignores non-positive values', () => {
    expect(s().recordUsage('1', 'api_calls', 0)).toBeNull();
  });

  it('aggregates into period buckets', () => {
    s().registerMeter('1', 'api_calls', { unitPrice: 1, includedUnits: 0, periodSecs: 3600 });
    clock = 3600;
    s().recordUsage('1', 'api_calls', 4);
    s().recordUsage('1', 'api_calls', 6);
    clock = 7300;
    s().recordUsage('1', 'api_calls', 3);
    const meter = s().getMeters('1')[0];
    expect(meter.buckets).toHaveLength(2);
    expect(meter.buckets[0].units).toBe(10);
    expect(meter.buckets[1].units).toBe(3);
  });

  it('charges across multiple meters with free tiers', () => {
    s().registerMeter('7', 'api_calls', { unitPrice: 2, includedUnits: 100 });
    s().registerMeter('7', 'gb_egress', { unitPrice: 5, includedUnits: 0 });
    s().recordUsage('7', 'api_calls', 150); // 50 * 2 = 100
    s().recordUsage('7', 'gb_egress', 4); // 4 * 5 = 20
    const charge = s().calculateUsageCharge('7', { start: 0, end: 100000 });
    expect(charge.total).toBe(120);
    expect(charge.lines).toHaveLength(2);
  });

  it('excludes usage outside the charge period', () => {
    s().registerMeter('1', 'api_calls', { unitPrice: 1, includedUnits: 0, periodSecs: 3600 });
    clock = 3600;
    s().recordUsage('1', 'api_calls', 10);
    clock = 100000;
    s().recordUsage('1', 'api_calls', 7);
    const charge = s().calculateUsageCharge('1', { start: 0, end: 50000 });
    expect(charge.total).toBe(10);
  });

  it('fires a usage alert once past the threshold', () => {
    s().registerMeter('1', 'api_calls', { unitPrice: 1, includedUnits: 0, alertThreshold: 100 });
    s().recordUsage('1', 'api_calls', 60);
    expect(s().alerts).toHaveLength(0);
    s().recordUsage('1', 'api_calls', 60);
    expect(s().alerts).toHaveLength(1);
    // Does not re-fire.
    s().recordUsage('1', 'api_calls', 60);
    expect(s().alerts).toHaveLength(1);
  });
});
