import { useCreditStore } from '../../stores/creditStore';

describe('credit wallet integration', () => {
  beforeEach(() => {
    useCreditStore.setState({
      accounts: {},
      nextId: 0,
      wallets: {},
      nextWalletId: 0,
      walletTransactionIds: {},
      now: () => 1_000,
    });
  });

  it('keeps wallet balance, receipts, and account credit independent', () => {
    const store = useCreditStore.getState();
    const walletId = store.createWallet('alice', 'sub_1', 'USD');

    store.issueCredit('alice', 500, 'refund');
    const deposit = store.deposit('alice', walletId, 1_000);
    const drawdown = store.drawdown('alice', walletId, 250);
    const applied = store.applyCredit('alice', 'sub_1', 200);

    expect(deposit?.balance).toBe(1_000);
    expect(drawdown?.balance).toBe(750);
    expect(applied).toMatchObject({ applied: 200, remainingDue: 0, balanceAfter: 300 });
    expect(useCreditStore.getState().getWallet(walletId)?.transactions).toHaveLength(2);
    expect(useCreditStore.getState().getBalance('alice')).toBe(300);
  });
});