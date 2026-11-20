import * as fs from 'fs';
import * as path from 'path';

import {
  INTERVALS,
  INTERVAL_SECONDS,
  SUBSCRIPTION_STATUSES,
  intervalSeconds,
  isInterval,
  isSubscriptionStatus,
} from '../contract';

const RUST_TYPES = path.resolve(__dirname, '../../../contracts/types/src/lib.rs');
const rust = fs.readFileSync(RUST_TYPES, 'utf8');

function rustEnumVariants(name: string): string[] {
  const match = rust.match(new RegExp(`pub enum ${name} \\{([^}]*)\\}`));
  if (!match) throw new Error(`enum ${name} not found in ${RUST_TYPES}`);
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter(Boolean);
}

function rustStructFields(name: string): string[] {
  const match = rust.match(new RegExp(`pub struct ${name} \\{([^}]*)\\}`));
  if (!match) throw new Error(`struct ${name} not found in ${RUST_TYPES}`);
  return [...match[1].matchAll(/pub (\w+):/g)].map((m) => m[1]);
}

describe('contract types stay in sync with contracts/types/src/lib.rs', () => {
  it('Interval variants match', () => {
    expect([...INTERVALS]).toEqual(rustEnumVariants('Interval'));
  });

  it('SubscriptionStatus variants match', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual(rustEnumVariants('SubscriptionStatus'));
  });

  it('INTERVAL_SECONDS matches Interval::seconds()', () => {
    for (const interval of INTERVALS) {
      const arm = rust.match(new RegExp(`Interval::${interval} => ([\\d_]+)`));
      expect(arm).not.toBeNull();
      expect(INTERVAL_SECONDS[interval]).toBe(Number(arm![1].replace(/_/g, '')));
    }
  });

  it('Plan and Subscription field names match', () => {
    const plan: Record<keyof import('../contract').Plan, true> = {
      id: true, merchant: true, name: true, price: true, token: true, interval: true,
      active: true, subscriber_count: true, created_at: true,
    };
    const subscription: Record<keyof import('../contract').Subscription, true> = {
      id: true, plan_id: true, subscriber: true, status: true, started_at: true,
      last_charged_at: true, next_charge_at: true, total_paid: true, total_gas_spent: true,
      charge_count: true, paused_at: true, pause_duration: true, refund_requested_amount: true,
    };
    expect(Object.keys(plan)).toEqual(rustStructFields('Plan'));
    expect(Object.keys(subscription)).toEqual(rustStructFields('Subscription'));
  });
});

describe('guards and helpers', () => {
  it('accepts known values and rejects others', () => {
    expect(isInterval('Daily')).toBe(true);
    expect(isInterval('monthly')).toBe(false);
    expect(isInterval(undefined)).toBe(false);
    expect(isSubscriptionStatus('PastDue')).toBe(true);
    expect(isSubscriptionStatus('past_due')).toBe(false);
    expect(isSubscriptionStatus(1)).toBe(false);
  });

  it('intervalSeconds returns contract values and rejects unknown input', () => {
    expect(intervalSeconds('Monthly')).toBe(2_592_000);
    expect(() => intervalSeconds('Fortnightly' as never)).toThrow(RangeError);
  });

  it('INTERVAL_SECONDS is immutable', () => {
    expect(Object.isFrozen(INTERVAL_SECONDS)).toBe(true);
  });
});
