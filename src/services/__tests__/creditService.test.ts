import {
  applyCreditToInvoice,
  buildCreditAccount,
  expireCredits,
  purchaseCredit,
  transferCredit,
} from '../creditService';

describe('creditService', () => {
  it('purchases credits and updates the running balance', () => {
    const account = buildCreditAccount('acct-1', 'USD');
    const updated = purchaseCredit(account, {
      amount: 50,
      paymentMethod: 'card',
      subscriptionId: 'sub-1',
      invoiceId: 'inv-1',
      reference: 'topup-001',
    });

    expect(updated.balance).toBe(50);
    expect(updated.totalPurchased).toBe(50);
    expect(updated.ledger).toHaveLength(1);
    expect(updated.ledger[0].balanceAfter).toBe(50);
  });

  it('applies credits to an invoice with a partial remainder', () => {
    const funded = purchaseCredit(buildCreditAccount('acct-2', 'USD'), {
      amount: 40,
      paymentMethod: 'wallet',
      subscriptionId: 'sub-2',
      invoiceId: 'inv-2',
    });

    const result = applyCreditToInvoice(funded, {
      invoiceId: 'invoice-2',
      subscriptionId: 'sub-2',
      invoiceTotal: 60,
      currency: 'USD',
      expectedRevision: funded.revision,
    });

    expect(result.appliedAmount).toBe(40);
    expect(result.remainingDue).toBe(20);
    expect(result.application?.status).toBe('partial');
    expect(result.account.balance).toBe(0);
  });

  it('blocks stale transfers when the revision changes', () => {
    const source = purchaseCredit(buildCreditAccount('acct-3', 'USD'), {
      amount: 25,
      paymentMethod: 'manual',
    });
    const target = buildCreditAccount('acct-4', 'USD');

    expect(() =>
      transferCredit(source, target, {
        amount: 10,
        expectedRevision: source.revision - 1,
      })
    ).toThrow('Credit balance changed');
  });

  it('expires due credits and clears the balance', () => {
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const account = purchaseCredit(buildCreditAccount('acct-5', 'USD'), {
      amount: 30,
      paymentMethod: 'bank_transfer',
      expiresAt: expiredDate,
    });

    const result = expireCredits(account, new Date());

    expect(result.expiredAmount).toBe(30);
    expect(result.account.balance).toBe(0);
    expect(result.account.ledger[result.account.ledger.length - 1]?.type).toBe('expiration');
  });
});
