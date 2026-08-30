import { useCreditStore } from '../creditStore';

let clock = 1000;
const reset = () =>
  useCreditStore.setState({ accounts: {}, wallets: {}, nextId: 0, now: () => clock });

beforeEach(() => {
  clock = 1000;
  reset();
});

const s = () => useCreditStore.getState();

describe('useCreditStore', () => {
  it('issues credit and reports the balance', () => {
    s().issueCredit('alice', 500, 'promo');
    expect(s().getBalance('alice')).toBe(500);
    expect(s().getAccount('alice').transactions).toHaveLength(1);
  });

  it('ignores non-positive issuance', () => {
    s().issueCredit('alice', 0, 'bad');
    expect(s().getBalance('alice')).toBe(0);
  });

  it('applies credit capped at the amount due', () => {
    s().issueCredit('alice', 300, 'refund');
    const applied = s().applyCredit('alice', 'sub_1', 500);
    expect(applied.applied).toBe(300);
    expect(applied.remainingDue).toBe(200);
    expect(applied.balanceAfter).toBe(0);
  });

  it('never goes negative when no credit exists', () => {
    const applied = s().applyCredit('alice', 'sub_1', 1000);
    expect(applied.applied).toBe(0);
    expect(s().getBalance('alice')).toBe(0);
  });

  it('transfers credit between accounts', () => {
    s().issueCredit('alice', 400, 'gift');
    expect(s().transferCredit('alice', 'bob', 150, 'gift')).toBe(true);
    expect(s().getBalance('alice')).toBe(250);
    expect(s().getBalance('bob')).toBe(150);
  });

  it('rejects overdrawn transfers', () => {
    s().issueCredit('alice', 100, 'gift');
    expect(s().transferCredit('alice', 'bob', 200, 'gift')).toBe(false);
  });

  it('expires credit past its deadline', () => {
    s().issueCredit('alice', 500, 'promo', 2000);
    expect(s().getBalance('alice')).toBe(500);
    clock = 2500;
    expect(s().getBalance('alice')).toBe(0);
    expect(s().expireCredits('alice')).toBe(500);
    expect(s().getAccount('alice').balance).toBe(0);
  });

  it('uses the expiration policy as a default expiry', () => {
    s().setExpirationPolicy('alice', { kind: 'after_secs', seconds: 100 });
    s().issueCredit('alice', 200, 'promo');
    clock = 1050;
    expect(s().getBalance('alice')).toBe(200);
    clock = 1200;
    expect(s().getBalance('alice')).toBe(0);
  });

  it('deposits credit into an account balance', () => {
    s().depositCredit('alice', 200, 'prepaid top-up');
    expect(s().getBalance('alice')).toBe(200);
    expect(
      s()
        .getAccount('alice')
        .transactions.some((t) => t.kind === 'deposit' && t.amount === 200)
    ).toBe(true);
  });

  it('withdraws available credit and rejects overdrafts', () => {
    s().issueCredit('alice', 300, 'promo');
    expect(s().withdrawCredit('alice', 100, 'cash-out')).toBe(true);
    expect(s().getBalance('alice')).toBe(200);
    expect(s().withdrawCredit('alice', 500, 'cash-out')).toBe(false);
    expect(s().getBalance('alice')).toBe(200);
  });

  it('computes a consolidated account balance summary', () => {
    useCreditStore.getState().wallets = {
      'w-1': {
        id: 'w-1',
        subscriber: 'alice',
        currency: 'USD',
        balance: 75,
        totalDeposited: 100,
        totalWithdrawn: 25,
      },
    };

    s().issueCredit('alice', 250, 'refund');
    s().applyCredit('alice', 'sub_1', 50);

    const balance = s().getAccountBalance('alice');
    expect(balance.subscriber).toBe('alice');
    expect(balance.availableCredit).toBe(200);
    expect(balance.totalIssued).toBe(250);
    expect(balance.totalApplied).toBe(50);
    expect(balance.prepaymentBalance).toBe(75);
    expect(balance.netBalance).toBe(275);
  });

  it('returns account balances for all known subscribers', () => {
    s().issueCredit('alice', 100, 'promo');
    s().issueCredit('bob', 200, 'promo');
    const balances = s().getAccountBalances();
    expect(balances).toHaveLength(2);
    expect(balances.map((b) => b.subscriber).sort()).toEqual(['alice', 'bob']);
  });
});
