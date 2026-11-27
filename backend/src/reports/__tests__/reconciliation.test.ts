import {
  ChargeReconciliationService,
  StructuredReconciliationMetrics,
  reconcileCharges,
  type ChargeReconciliationProviderSource,
  type LedgerChargeRecord,
  type ProviderChargeRecord,
  type ReconciliationWindow,
} from '../reconciliation';

const window: ReconciliationWindow = {
  startInclusive: '2026-11-20T00:00:00.000Z',
  endExclusive: '2026-11-21T00:00:00.000Z',
};

function source(
  provider: 'stripe' | 'paypal' | 'paddle',
  records: ProviderChargeRecord[],
  error?: Error,
): ChargeReconciliationProviderSource {
  return {
    provider,
    listCharges: error
      ? async () => { throw error; }
      : async () => records,
  };
}

describe('ChargeReconciliationService', () => {
  it('reports exact ledger/provider matches and snapshot totals', async () => {
    const ledger: LedgerChargeRecord[] = [{
      chargeId: 'charge-1',
      provider: 'stripe',
      providerChargeId: 'pi_123',
      amountMinor: 2999,
      currency: 'usd',
      status: 'succeeded',
    }];
    const provider: ProviderChargeRecord[] = [{
      provider: 'stripe',
      providerChargeId: 'pi_123',
      amountMinor: 2999,
      currency: 'USD',
      status: 'succeeded',
    }];
    const metrics = new StructuredReconciliationMetrics();
    const service = new ChargeReconciliationService({
      metrics,
      now: () => Date.parse('2026-11-21T12:00:00.000Z'),
    });

    const report = await service.reconcile(ledger, [source('stripe', provider)], window);

    expect(report.generatedAt).toBe('2026-11-21T12:00:00.000Z');
    expect(report.totals).toEqual({
      ledger: 1,
      provider: 1,
      matched: 1,
      ledgerOnly: 0,
      providerOnly: 0,
      mismatched: 0,
      duplicates: 0,
    });
    expect(report.issues[0]).toMatchObject({ status: 'matched', chargeId: 'charge-1' });
    expect(metrics.getReports()).toEqual([report]);
  });

  it('matches a ledger reference ID to provider reference ID', async () => {
    const ledger: LedgerChargeRecord[] = [{
      chargeId: 'charge-2',
      provider: 'paypal',
      referenceId: 'order-42',
      amountMinor: 500,
      currency: 'USD',
    }];
    const provider: ProviderChargeRecord[] = [{
      provider: 'paypal',
      providerChargeId: 'txn-42',
      referenceId: 'order-42',
      amountMinor: 500,
      currency: 'USD',
      status: 'succeeded',
    }];

    const report = await reconcileCharges(
      ledger,
      [source('paypal', provider)],
      window,
    );

    expect(report.totals.matched).toBe(1);
    expect(report.issues[0]).toMatchObject({ status: 'matched', chargeId: 'charge-2' });
  });

  it('reports ledger-only and provider-only charges', async () => {
    const ledger: LedgerChargeRecord[] = [{
      chargeId: 'missing-provider',
      provider: 'paddle',
      providerChargeId: 'tx_missing',
      amountMinor: 100,
      currency: 'EUR',
    }];

    const report = await reconcileCharges(
      ledger,
      [source('paddle', [{
        provider: 'paddle',
        providerChargeId: 'tx_extra',
        amountMinor: 200,
        currency: 'EUR',
        status: 'succeeded',
      }])],
      window,
    );

    expect(report.totals.ledgerOnly).toBe(1);
    expect(report.totals.providerOnly).toBe(1);
    expect(report.issues.map((issue) => issue.status)).toEqual(
      expect.arrayContaining(['ledger_only', 'provider_only']),
    );
  });

  it.each([
    ['amount', 499, 'USD', 'succeeded', 'amount_mismatch'],
    ['currency', 500, 'EUR', 'succeeded', 'currency_mismatch'],
    ['status', 500, 'USD', 'pending', 'status_mismatch'],
  ] as const)(
    'reports a %s mismatch',
    async (_name, amountMinor, currency, providerStatus, expectedStatus) => {
      const report = await reconcileCharges(
        [{
          chargeId: 'charge-mismatch',
          provider: 'stripe',
          providerChargeId: 'pi_mismatch',
          amountMinor: 500,
          currency: 'USD',
          status: 'succeeded',
        }],
        [source('stripe', [{
          provider: 'stripe',
          providerChargeId: 'pi_mismatch',
          amountMinor,
          currency,
          status: providerStatus,
        }])],
        window,
      );

      expect(report.totals.mismatched).toBe(1);
      expect(report.issues[0]).toMatchObject({ status: expectedStatus });
    },
  );

  it('flags duplicate provider or ledger records', async () => {
    const report = await reconcileCharges(
      [
        { chargeId: 'one', provider: 'stripe', providerChargeId: 'pi_duplicate', amountMinor: 500, currency: 'USD' },
        { chargeId: 'two', provider: 'stripe', providerChargeId: 'pi_duplicate', amountMinor: 500, currency: 'USD' },
      ],
      [source('stripe', [{
        provider: 'stripe',
        providerChargeId: 'pi_duplicate',
        amountMinor: 500,
        currency: 'USD',
        status: 'succeeded',
      }])],
      window,
    );

    expect(report.totals.duplicates).toBe(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'duplicate' }),
    ]));
  });

  it('captures provider failures without discarding other provider results', async () => {
    const report = await reconcileCharges(
      [{ chargeId: 'paddle-1', provider: 'paddle', providerChargeId: 'tx_1', amountMinor: 100, currency: 'USD' }],
      [
        source('stripe', [{
          provider: 'stripe',
          providerChargeId: 'pi_1',
          amountMinor: 100,
          currency: 'USD',
          status: 'succeeded',
        }]),
        source('paddle', [], new Error('Paddle unavailable')),
      ],
      window,
    );

    expect(report.providerErrors).toEqual([{
      provider: 'paddle',
      message: 'Paddle unavailable',
    }]);
    expect(report.totals.ledgerOnly).toBe(1);
  });

  it('rejects invalid records and currencies', async () => {
    await expect(reconcileCharges(
      [{ chargeId: 'bad', provider: 'stripe', amountMinor: -1, currency: 'US1' }],
      [source('stripe', [])],
      window,
    )).rejects.toThrow('Invalid reconciliation');
  });

  it('does not count ledger records for providers absent from the reconciliation window', async () => {
    const report = await reconcileCharges(
      [{ chargeId: 'paypal-1', provider: 'paypal', providerChargeId: 'txn_1', amountMinor: 100, currency: 'USD' }],
      [source('stripe', [])],
      window,
    );

    expect(report.totals.ledger).toBe(0);
    expect(report.totals.ledgerOnly).toBe(0);
  });
});
