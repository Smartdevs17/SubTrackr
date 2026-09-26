import {
  MultiChainSubscriptionService,
  balanceKey,
  type ChainBinding,
  type ConversionRate,
  type MultiChainSubscription,
} from '../multiChainSubscriptionService';
import { ChainType } from '../../types/wallet';

const POLYGON: ChainBinding = {
  chainType: ChainType.EVM,
  chainId: 137,
  networkId: 'polygon',
  tokenSymbol: 'USDC',
  walletAddress: '0xpayer',
};

const STELLAR: ChainBinding = {
  chainType: ChainType.STELLAR,
  chainId: 0x8000,
  networkId: 'stellar-mainnet',
  tokenSymbol: 'XLM',
  walletAddress: 'GPAYER',
};

const ARBITRUM: ChainBinding = {
  chainType: ChainType.EVM,
  chainId: 42161,
  networkId: 'arbitrum',
  tokenSymbol: 'USDC',
  walletAddress: '0xpayer',
};

const RATES: ConversionRate[] = [
  { tokenSymbol: 'USDC', rate: 1, asOf: new Date('2026-01-01') },
  { tokenSymbol: 'XLM', rate: 0.25, asOf: new Date('2026-01-01') },
];

const sub = (overrides: Partial<MultiChainSubscription> = {}): MultiChainSubscription => ({
  subscriptionId: 'sub-1',
  subscriberId: 'payer-1',
  name: 'Pro Plan',
  amount: 10,
  binding: POLYGON,
  nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
  isActive: true,
  ...overrides,
});

let service: MultiChainSubscriptionService;

beforeEach(() => {
  service = MultiChainSubscriptionService.getInstance();
  service.reset();
});

describe('registration', () => {
  it('registers and reads back a subscription', () => {
    service.register(sub());
    expect(service.get('sub-1')?.name).toBe('Pro Plan');
    expect(service.list('payer-1')).toHaveLength(1);
  });

  it('rejects a subscription with no id', () => {
    expect(() => service.register(sub({ subscriptionId: '' }))).toThrow(/requires a subscriptionId/);
  });

  it('rejects a negative or non-finite amount', () => {
    expect(() => service.register(sub({ amount: -1 }))).toThrow(/negative or non-finite/);
    expect(() => service.register(sub({ amount: Number.NaN }))).toThrow(/negative or non-finite/);
  });

  it('rejects a subscription with no network binding', () => {
    expect(() =>
      service.register(sub({ binding: { ...POLYGON, networkId: '' } }))
    ).toThrow(/not bound to a network/);
  });

  it('scopes listings by subscriber', () => {
    service.register(sub());
    service.register(sub({ subscriptionId: 'sub-2', subscriberId: 'payer-2' }));
    expect(service.list('payer-1')).toHaveLength(1);
    expect(service.list()).toHaveLength(2);
  });

  it('lists the distinct networks a payer uses', () => {
    service.register(sub());
    service.register(sub({ subscriptionId: 'sub-2', binding: STELLAR }));
    service.register(sub({ subscriptionId: 'sub-3', binding: POLYGON }));
    expect(service.listNetworks('payer-1').sort()).toEqual(['polygon', 'stellar-mainnet']);
  });

  it('unregisters a subscription', () => {
    service.register(sub());
    expect(service.unregister('sub-1')).toBe(true);
    expect(service.unregister('sub-1')).toBe(false);
    expect(service.get('sub-1')).toBeUndefined();
  });

  it('rebinds a subscription to another chain without changing the amount', () => {
    service.register(sub());
    const rebound = service.rebind('sub-1', STELLAR);
    expect(rebound?.binding.networkId).toBe('stellar-mainnet');
    expect(rebound?.amount).toBe(10);
    expect(service.get('sub-1')?.binding.tokenSymbol).toBe('XLM');
  });

  it('returns null when rebinding an unknown subscription', () => {
    expect(service.rebind('nope', STELLAR)).toBeNull();
  });
});

describe('buildUnifiedStatement', () => {
  it('converts every chain into one currency and totals them', () => {
    service.register(sub({ amount: 10, binding: POLYGON }));
    service.register(sub({ subscriptionId: 'sub-2', amount: 40, binding: STELLAR }));

    const statement = service.buildUnifiedStatement('payer-1', { rates: RATES });
    expect(statement.currency).toBe('USD');
    expect(statement.lines).toHaveLength(2);
    // 10 USDC @ 1 + 40 XLM @ 0.25 = 20
    expect(statement.total).toBe(20);
  });

  it('breaks the total down per chain, keeping native token amounts', () => {
    service.register(sub({ amount: 10, binding: POLYGON }));
    service.register(sub({ subscriptionId: 'sub-2', amount: 40, binding: STELLAR }));

    const { chainSubtotals } = service.buildUnifiedStatement('payer-1', { rates: RATES });
    const polygon = chainSubtotals.find((c) => c.networkId === 'polygon')!;
    const stellar = chainSubtotals.find((c) => c.networkId === 'stellar-mainnet')!;

    expect(polygon.nativeTotals).toEqual({ USDC: 10 });
    expect(polygon.convertedTotal).toBe(10);
    expect(stellar.nativeTotals).toEqual({ XLM: 40 });
    expect(stellar.convertedTotal).toBe(10);
    expect(stellar.chainType).toBe(ChainType.STELLAR);
  });

  it('sums several subscriptions on the same chain into one subtotal', () => {
    service.register(sub({ subscriptionId: 'sub-1', amount: 10 }));
    service.register(sub({ subscriptionId: 'sub-2', amount: 15 }));

    const { chainSubtotals } = service.buildUnifiedStatement('payer-1', { rates: RATES });
    expect(chainSubtotals).toHaveLength(1);
    expect(chainSubtotals[0].subscriptionCount).toBe(2);
    expect(chainSubtotals[0].nativeTotals.USDC).toBe(25);
  });

  it('needs no rate for a token already in the statement currency', () => {
    service.register(sub({ amount: 10, binding: { ...POLYGON, tokenSymbol: 'USD' } }));
    const statement = service.buildUnifiedStatement('payer-1', { rates: [] });
    expect(statement.total).toBe(10);
    expect(statement.unpricedSubscriptionIds).toEqual([]);
  });

  it('reports unpriced subscriptions instead of counting them as zero', () => {
    service.register(sub({ amount: 10, binding: POLYGON }));
    service.register(sub({ subscriptionId: 'sub-2', amount: 40, binding: STELLAR }));

    const statement = service.buildUnifiedStatement('payer-1', {
      rates: [{ tokenSymbol: 'USDC', rate: 1, asOf: new Date() }],
    });
    expect(statement.total).toBe(10);
    expect(statement.unpricedSubscriptionIds).toEqual(['sub-2']);
    expect(statement.lines).toHaveLength(1);
    // The chain still appears with its native amount, so nothing goes missing.
    const stellar = statement.chainSubtotals.find((c) => c.networkId === 'stellar-mainnet')!;
    expect(stellar.nativeTotals.XLM).toBe(40);
    expect(stellar.convertedTotal).toBe(0);
  });

  it('matches rates case-insensitively', () => {
    service.register(sub({ amount: 10, binding: { ...POLYGON, tokenSymbol: 'usdc' } }));
    const statement = service.buildUnifiedStatement('payer-1', { rates: RATES });
    expect(statement.total).toBe(10);
  });

  it('excludes inactive subscriptions by default', () => {
    service.register(sub({ isActive: false }));
    expect(service.buildUnifiedStatement('payer-1', { rates: RATES }).lines).toHaveLength(0);
    expect(
      service.buildUnifiedStatement('payer-1', { rates: RATES, includeInactive: true }).lines
    ).toHaveLength(1);
  });

  it('filters to charges due before a cutoff', () => {
    service.register(sub({ nextBillingDate: new Date('2026-01-15T00:00:00.000Z') }));
    service.register(
      sub({ subscriptionId: 'sub-2', nextBillingDate: new Date('2026-03-01T00:00:00.000Z') })
    );

    const statement = service.buildUnifiedStatement('payer-1', {
      rates: RATES,
      dueBefore: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(statement.lines.map((l) => l.subscriptionId)).toEqual(['sub-1']);
  });

  it('honours a non-USD statement currency', () => {
    service.register(sub({ amount: 8, binding: STELLAR }));
    const statement = service.buildUnifiedStatement('payer-1', {
      currency: 'EUR',
      rates: [{ tokenSymbol: 'XLM', rate: 0.5, asOf: new Date() }],
    });
    expect(statement.currency).toBe('EUR');
    expect(statement.total).toBe(4);
  });

  it('returns an empty statement for a payer with nothing registered', () => {
    const statement = service.buildUnifiedStatement('nobody', { rates: RATES });
    expect(statement.total).toBe(0);
    expect(statement.lines).toEqual([]);
    expect(statement.chainSubtotals).toEqual([]);
  });
});

describe('planSettlement', () => {
  it('settles directly when every chain is healthy', () => {
    service.register(sub());
    service.register(sub({ subscriptionId: 'sub-2', binding: STELLAR }));

    const plan = service.planSettlement('payer-1');
    expect(plan.steps.every((s) => s.action === 'direct')).toBe(true);
    expect(plan.bridgedCount).toBe(0);
    expect(plan.blockedCount).toBe(0);
  });

  it('treats a chain absent from the health list as healthy', () => {
    service.register(sub());
    const plan = service.planSettlement('payer-1', {
      health: [{ networkId: 'some-other-chain', healthy: false }],
    });
    expect(plan.steps[0].action).toBe('direct');
  });

  it('bridges from another funded chain when the target is down', () => {
    service.register(sub({ binding: POLYGON, amount: 10 }));
    service.register(sub({ subscriptionId: 'sub-2', binding: ARBITRUM, amount: 5 }));

    const plan = service.planSettlement('payer-1', {
      health: [{ networkId: 'polygon', healthy: false }],
      balances: { [balanceKey('arbitrum', 'USDC')]: 100 },
    });

    const bridged = plan.steps.find((s) => s.subscriptionId === 'sub-1')!;
    expect(bridged.action).toBe('bridge');
    expect(bridged.sourceNetworkId).toBe('arbitrum');
    expect(bridged.targetNetworkId).toBe('polygon');
    expect(bridged.reason).toContain('polygon is unavailable');
    expect(plan.bridgedCount).toBe(1);
  });

  it('blocks when the fallback chain lacks enough of the token', () => {
    service.register(sub({ binding: POLYGON, amount: 10 }));
    service.register(sub({ subscriptionId: 'sub-2', binding: ARBITRUM, amount: 5 }));

    const plan = service.planSettlement('payer-1', {
      health: [{ networkId: 'polygon', healthy: false }],
      balances: { [balanceKey('arbitrum', 'USDC')]: 3 },
    });

    const blocked = plan.steps.find((s) => s.subscriptionId === 'sub-1')!;
    expect(blocked.action).toBe('blocked');
    expect(blocked.reason).toContain('no other chain holds enough USDC');
    expect(plan.blockedCount).toBe(1);
  });

  it('blocks when the payer uses only the failed chain', () => {
    service.register(sub({ binding: POLYGON }));
    const plan = service.planSettlement('payer-1', {
      health: [{ networkId: 'polygon', healthy: false }],
    });
    expect(plan.steps[0].action).toBe('blocked');
  });

  it('will not route through another unhealthy chain', () => {
    service.register(sub({ binding: POLYGON, amount: 10 }));
    service.register(sub({ subscriptionId: 'sub-2', binding: ARBITRUM, amount: 5 }));

    const plan = service.planSettlement('payer-1', {
      health: [
        { networkId: 'polygon', healthy: false },
        { networkId: 'arbitrum', healthy: false },
      ],
      balances: { [balanceKey('arbitrum', 'USDC')]: 100 },
    });
    expect(plan.blockedCount).toBe(2);
  });

  it('will not route a token the fallback chain does not hold', () => {
    // The fallback holds USDC, but the failed charge is denominated in XLM.
    service.register(sub({ binding: STELLAR, amount: 10 }));
    service.register(sub({ subscriptionId: 'sub-2', binding: ARBITRUM, amount: 5 }));

    const plan = service.planSettlement('payer-1', {
      health: [{ networkId: 'stellar-mainnet', healthy: false }],
      balances: { [balanceKey('arbitrum', 'USDC')]: 100 },
    });
    expect(plan.steps.find((s) => s.subscriptionId === 'sub-1')?.action).toBe('blocked');
  });

  it('skips inactive subscriptions', () => {
    service.register(sub({ isActive: false }));
    expect(service.planSettlement('payer-1').steps).toHaveLength(0);
  });
});

describe('balanceKey', () => {
  it('namespaces a token by its chain', () => {
    expect(balanceKey('polygon', 'USDC')).toBe('polygon::USDC');
  });
});
