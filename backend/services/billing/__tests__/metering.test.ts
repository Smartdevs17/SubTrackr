import {
  buildOverageLadder,
  marginalUnitPrice,
  quoteMeter,
  rateMeter,
  rateUsage,
  toContractTiers,
  validateMeterPricingPlan,
  validateOverageTiers,
  type MeterPricingPlan,
  type OverageTier,
} from '../metering';

const period = (days = 30) => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = new Date(start.getTime() + days * 86_400_000);
  return { start, end };
};

const flatPlan = (overrides: Partial<MeterPricingPlan> = {}): MeterPricingPlan => ({
  metric: 'api_calls',
  model: 'flat',
  includedUnits: 0,
  unitPrice: 2,
  ...overrides,
});

describe('validateOverageTiers', () => {
  it('accepts an ascending ladder terminated by an unbounded tier', () => {
    expect(() =>
      validateOverageTiers([
        { upToUnits: 100, unitPrice: 5 },
        { upToUnits: 1_000, unitPrice: 3 },
        { upToUnits: null, unitPrice: 1 },
      ])
    ).not.toThrow();
  });

  it('accepts a fully bounded ladder', () => {
    expect(() =>
      validateOverageTiers([
        { upToUnits: 100, unitPrice: 5 },
        { upToUnits: 1_000, unitPrice: 3 },
      ])
    ).not.toThrow();
  });

  it('rejects descending bounds', () => {
    expect(() =>
      validateOverageTiers([
        { upToUnits: 1_000, unitPrice: 1 },
        { upToUnits: 100, unitPrice: 2 },
      ])
    ).toThrow(/strictly ascend/);
  });

  it('rejects duplicate bounds', () => {
    expect(() =>
      validateOverageTiers([
        { upToUnits: 100, unitPrice: 1 },
        { upToUnits: 100, unitPrice: 2 },
      ])
    ).toThrow(/strictly ascend/);
  });

  it('rejects an unbounded tier that is not last', () => {
    expect(() =>
      validateOverageTiers([
        { upToUnits: null, unitPrice: 1 },
        { upToUnits: 100, unitPrice: 2 },
      ])
    ).toThrow(/must be the last tier/);
  });

  it('rejects negative prices and fees', () => {
    expect(() => validateOverageTiers([{ upToUnits: null, unitPrice: -1 }])).toThrow(
      /unitPrice/
    );
    expect(() =>
      validateOverageTiers([{ upToUnits: null, unitPrice: 1, flatFee: -5 }])
    ).toThrow(/flatFee/);
  });
});

describe('validateMeterPricingPlan', () => {
  it('requires a ladder for every non-flat model', () => {
    for (const model of ['graduated', 'volume', 'package'] as const) {
      expect(() => validateMeterPricingPlan(flatPlan({ model }))).toThrow(/defines no tiers/);
    }
  });

  it('allows a flat plan with no ladder', () => {
    expect(() => validateMeterPricingPlan(flatPlan())).not.toThrow();
  });

  it('rejects a minimum above the maximum', () => {
    expect(() =>
      validateMeterPricingPlan(flatPlan({ minimumCharge: 100, maximumCharge: 10 }))
    ).toThrow(/minimumCharge above its maximumCharge/);
  });

  it('rejects a negative included allowance', () => {
    expect(() => validateMeterPricingPlan(flatPlan({ includedUnits: -1 }))).toThrow(
      /includedUnits/
    );
  });
});

describe('rateMeter — flat', () => {
  it('bills every unit past the included allowance', () => {
    const line = rateMeter(flatPlan({ includedUnits: 100, unitPrice: 2 }), 150);
    expect(line.billableUnits).toBe(50);
    expect(line.amount).toBe(100);
    expect(line.tierLines).toHaveLength(1);
  });

  it('bills nothing inside the included allowance', () => {
    const line = rateMeter(flatPlan({ includedUnits: 100 }), 100);
    expect(line.billableUnits).toBe(0);
    expect(line.amount).toBe(0);
    expect(line.tierLines).toHaveLength(0);
  });

  it('rejects a negative unit count', () => {
    expect(() => rateMeter(flatPlan(), -1)).toThrow(/negative or non-finite/);
  });
});

describe('rateMeter — graduated', () => {
  const plan: MeterPricingPlan = {
    metric: 'api_calls',
    model: 'graduated',
    includedUnits: 100,
    unitPrice: 1,
    tiers: [
      { upToUnits: 1_000, unitPrice: 3 },
      { upToUnits: null, unitPrice: 1 },
    ],
  };

  it('prices each slice at its own band rate', () => {
    // 1_600 used - 100 free = 1_500 billable -> 1_000 @ 3 + 500 @ 1.
    const line = rateMeter(plan, 1_600);
    expect(line.billableUnits).toBe(1_500);
    expect(line.amount).toBe(3_500);
    expect(line.tierLines.map((t) => [t.units, t.amount])).toEqual([
      [1_000, 3_000],
      [500, 500],
    ]);
  });

  it('stays inside the first band when the overage is small', () => {
    const line = rateMeter(plan, 300);
    expect(line.tierLines).toHaveLength(1);
    expect(line.amount).toBe(600);
  });

  it('adds a band flat fee once when the band is entered', () => {
    const withFee: MeterPricingPlan = {
      ...plan,
      tiers: [{ upToUnits: null, unitPrice: 2, flatFee: 50 }],
    };
    // 20 used - 100 free = 0 billable, so no fee is charged.
    expect(rateMeter(withFee, 20).amount).toBe(0);
    // 110 used - 100 free = 10 billable -> 10 * 2 + 50.
    expect(rateMeter(withFee, 110).amount).toBe(70);
  });

  it('bills overflow past a truncated ladder at the meter unit price', () => {
    const truncated: MeterPricingPlan = {
      metric: 'api_calls',
      model: 'graduated',
      includedUnits: 0,
      unitPrice: 7,
      tiers: [{ upToUnits: 10, unitPrice: 1 }],
    };
    // 10 @ 1 = 10, then the remaining 5 fall back to the meter rate: 5 @ 7 = 35.
    expect(rateMeter(truncated, 15).amount).toBe(45);
  });
});

describe('rateMeter — volume', () => {
  const plan: MeterPricingPlan = {
    metric: 'api_calls',
    model: 'volume',
    includedUnits: 0,
    unitPrice: 0,
    tiers: [
      { upToUnits: 100, unitPrice: 10 },
      { upToUnits: 1_000, unitPrice: 6 },
      { upToUnits: null, unitPrice: 4 },
    ],
  };

  it('prices every unit at the rate of the band the total lands in', () => {
    expect(rateMeter(plan, 500).amount).toBe(3_000);
  });

  it('re-prices the whole volume when a boundary is crossed', () => {
    expect(rateMeter(plan, 100).amount).toBe(1_000);
    // One more unit drops the whole bill into the cheaper band.
    expect(rateMeter(plan, 101).amount).toBe(606);
  });

  it('uses the unbounded band past the top bound', () => {
    expect(rateMeter(plan, 5_000).amount).toBe(20_000);
  });
});

describe('rateMeter — package', () => {
  const plan: MeterPricingPlan = {
    metric: 'sms',
    model: 'package',
    includedUnits: 0,
    unitPrice: 0,
    // Blocks of 1_000 units at 25 per started block.
    tiers: [{ upToUnits: 1_000, unitPrice: 0, flatFee: 25 }],
  };

  it('charges whole blocks, rounding partial blocks up', () => {
    expect(rateMeter(plan, 1).amount).toBe(25);
    expect(rateMeter(plan, 1_000).amount).toBe(25);
    expect(rateMeter(plan, 1_001).amount).toBe(50);
    expect(rateMeter(plan, 2_001).amount).toBe(75);
  });

  it('charges nothing for zero usage', () => {
    expect(rateMeter(plan, 0).amount).toBe(0);
  });
});

describe('rateMeter — proration', () => {
  const plan = flatPlan({ includedUnits: 1_000, unitPrice: 2 });

  it('scales the included allowance by the active fraction of the period', () => {
    const line = rateMeter(plan, 600, 0.5);
    expect(line.includedUnits).toBe(500);
    expect(line.billableUnits).toBe(100);
    expect(line.amount).toBe(200);
  });

  it('never scales consumed units', () => {
    expect(rateMeter(plan, 2_000, 0.5).unitsUsed).toBe(2_000);
  });

  it('clamps the factor into [0, 1]', () => {
    expect(rateMeter(plan, 0, -3).includedUnits).toBe(0);
    expect(rateMeter(plan, 0, 99).includedUnits).toBe(1_000);
  });
});

describe('rateUsage', () => {
  const plans: MeterPricingPlan[] = [
    {
      metric: 'api_calls',
      model: 'graduated',
      includedUnits: 100,
      unitPrice: 1,
      tiers: [
        { upToUnits: 1_000, unitPrice: 3 },
        { upToUnits: null, unitPrice: 1 },
      ],
    },
    { metric: 'gb_egress', model: 'flat', includedUnits: 0, unitPrice: 5 },
  ];

  it('rates every meter and sums the bill', () => {
    const bill = rateUsage({
      subscriptionId: 'sub_1',
      period: period(),
      usageByMetric: { api_calls: 1_600, gb_egress: 4 },
      plans,
    });
    expect(bill.lines).toHaveLength(2);
    expect(bill.subtotal).toBe(3_520);
    expect(bill.total).toBe(3_520);
    expect(bill.currency).toBe('USD');
  });

  it('treats a metric with no recorded usage as zero', () => {
    const bill = rateUsage({
      subscriptionId: 'sub_1',
      period: period(),
      usageByMetric: {},
      plans,
    });
    expect(bill.total).toBe(0);
    expect(bill.lines.every((l) => l.billableUnits === 0)).toBe(true);
  });

  it('tops the bill up to a minimum charge', () => {
    const bill = rateUsage({
      subscriptionId: 'sub_1',
      period: period(),
      usageByMetric: { gb_egress: 1 },
      plans: [{ metric: 'gb_egress', model: 'flat', includedUnits: 0, unitPrice: 5, minimumCharge: 50 }],
    });
    expect(bill.subtotal).toBe(5);
    expect(bill.minimumAdjustment).toBe(45);
    expect(bill.total).toBe(50);
  });

  it('trims the bill down to a spend cap', () => {
    const bill = rateUsage({
      subscriptionId: 'sub_1',
      period: period(),
      usageByMetric: { gb_egress: 1_000 },
      plans: [{ metric: 'gb_egress', model: 'flat', includedUnits: 0, unitPrice: 5, maximumCharge: 100 }],
    });
    expect(bill.subtotal).toBe(5_000);
    expect(bill.maximumAdjustment).toBe(-4_900);
    expect(bill.total).toBe(100);
  });

  it('rejects an inverted billing period', () => {
    const { start, end } = period();
    expect(() =>
      rateUsage({
        subscriptionId: 'sub_1',
        period: { start: end, end: start },
        usageByMetric: {},
        plans,
      })
    ).toThrow(/ends before it starts/);
  });

  it('prefers an explicit currency over the plan currency', () => {
    const bill = rateUsage({
      subscriptionId: 'sub_1',
      period: period(),
      usageByMetric: {},
      plans: [{ ...plans[1], currency: 'EUR' }],
      currency: 'XLM',
    });
    expect(bill.currency).toBe('XLM');
  });
});

describe('quoteMeter and marginalUnitPrice', () => {
  const plan: MeterPricingPlan = {
    metric: 'api_calls',
    model: 'graduated',
    includedUnits: 100,
    unitPrice: 1,
    tiers: [
      { upToUnits: 1_000, unitPrice: 3 },
      { upToUnits: null, unitPrice: 1 },
    ],
  };

  it('quotes a hypothetical volume', () => {
    expect(quoteMeter(plan, 1_600).amount).toBe(3_500);
  });

  it('reports the marginal cost of the next unit', () => {
    // Inside the free allowance the next unit is free.
    expect(marginalUnitPrice(plan, 50)).toBe(0);
    // In the first overage band it costs the band rate.
    expect(marginalUnitPrice(plan, 500)).toBe(3);
    // Past the band boundary it drops to the cheaper rate.
    expect(marginalUnitPrice(plan, 2_000)).toBe(1);
  });
});

describe('toContractTiers', () => {
  it('encodes the unbounded tier as 0 for the Soroban contract', () => {
    const tiers: OverageTier[] = [
      { upToUnits: 1_000, unitPrice: 3 },
      { upToUnits: null, unitPrice: 1, flatFee: 7 },
    ];
    expect(toContractTiers(tiers)).toEqual([
      { up_to_units: 1_000, unit_price: 3, flat_fee: 0 },
      { up_to_units: 0, unit_price: 1, flat_fee: 7 },
    ]);
  });

  it('validates before encoding', () => {
    expect(() =>
      toContractTiers([
        { upToUnits: 1_000, unitPrice: 1 },
        { upToUnits: 100, unitPrice: 2 },
      ])
    ).toThrow(/strictly ascend/);
  });
});

describe('buildOverageLadder', () => {
  it('produces a single unbounded band', () => {
    expect(buildOverageLadder(4)).toEqual([{ upToUnits: null, unitPrice: 4 }]);
  });
});
