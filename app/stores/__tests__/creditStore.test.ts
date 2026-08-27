import { useCreditStore } from '../creditStore';

let clock = 1000;
const reset = () =>
  useCreditStore.setState({
    accounts: {},
    nextId: 0,
    wallets: {},
    nextWalletId: 0,
    walletTransactionIds: {},
    now: () => clock,
  });

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

  it('manages wallet deposits, withdrawals, and charge drawdowns', () => {
    const walletId = s().createWallet('alice', 'sub_1', 'USD');
    expect(s().deposit('alice', walletId, 1000)).toMatchObject({
      walletId,
      balance: 1000,
      transactionId: 0,
    });
    expect(s().drawdown('alice', walletId, 250)).toMatchObject({
      balance: 750,
      transactionId: 1,
    });
    expect(s().withdraw('alice', walletId, 100)).toMatchObject({
      balance: 650,
      transactionId: 2,
    });
    expect(s().getWallet(walletId)).toMatchObject({
      balance: 650,
      totalDeposited: 1000,
      totalDrawn: 250,
      totalWithdrawn: 100,
      transactions: [
        { id: 0, kind: 'deposit', amount: 1000, balanceAfter: 1000 },
        { id: 1, kind: 'drawdown', amount: 250, balanceAfter: 750 },
        { id: 2, kind: 'withdraw', amount: 100, balanceAfter: 650 },
      ],
    });
  });

  it('rejects unauthorized and overdrawn wallet operations', () => {
    const walletId = s().createWallet('alice', 'sub_1', 'USD');
    s().deposit('alice', walletId, 100);
    expect(s().drawdown('alice', walletId, 101)).toBeUndefined();
    expect(s().withdraw('bob', walletId, 1)).toBeUndefined();
  });

  it('does not expose mutable account or wallet state', () => {
    s().issueCredit('alice', 100, 'promo');
    const account = s().getAccount('alice');
    account.lots[0].remaining = 0;
    expect(s().getBalance('alice')).toBe(100);

    const walletId = s().createWallet('alice', 'sub_1', 'USD');
    const wallet = s().getWallet(walletId);
    if (wallet) wallet.balance = 99;
    expect(s().getWallet(walletId)?.balance).toBe(0);
  });

  it('retains only the bounded recent transaction history', () => {
    for (let index = 0; index < 130; index += 1) {
      s().issueCredit('alice', 1, `grant-${index}`);
    }
    const history = s().getAccount('alice').transactions;
    expect(history).toHaveLength(128);
    expect(history[0].reason).toBe('grant-2');
    expect(history[127].reason).toBe('grant-129');
  });
});
