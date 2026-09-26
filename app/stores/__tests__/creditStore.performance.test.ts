import { useCreditStore } from '../creditStore';

describe('credit store performance', () => {
  it('processes 100 credit applications within the local budget', () => {
    useCreditStore.setState({
      accounts: {},
      nextId: 0,
      wallets: {},
      nextWalletId: 0,
      walletTransactionIds: {},
      now: () => 1_000,
    });
    const store = useCreditStore.getState();
    const startedAt = performance.now();

    for (let index = 0; index < 100; index += 1) {
      store.issueCredit(`subscriber-${index}`, 100, 'benchmark');
      store.applyCredit(`subscriber-${index}`, `subscription-${index}`, 50);
    }

    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });
});