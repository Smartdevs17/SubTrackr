import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  useAppStore,
  selectAuthToken,
  selectIsAuthenticated,
  selectUserId,
  selectPreferredCurrency,
  selectCurrentNetwork,
  selectTransactions,
} from '../slices';
import { SubscriptionTier } from '../../types/subscription';
import { TransactionStatus } from '../../types/transaction';
import type { UserProfile } from '../../types/api';

/**
 * The slices test verifies that:
 *  - each slice is composed into the combined useAppStore;
 *  - cross-slice state is independently accessible and settable;
 *  - actions from different slices do not interfere (modularity);
 *  - per-slice selectors return the expected fields.
 */
describe('zustand slices pattern (useAppStore)', () => {
  beforeEach(() => {
    useAppStore.setState({
      token: null,
      userId: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      user: null,
      subscriptionTier: SubscriptionTier.FREE,
      consent: {
        analytics: false,
        marketing: false,
        notifications: true,
        hasAcceptedPolicy: false,
      },
      preferredCurrency: 'USD',
      notificationsEnabled: true,
      exchangeRates: null,
      healthScoreWeights: null,
      currentNetwork: null,
      availableNetworks: [],
      transactions: [],
    });
  });

  it('composes auth slice state + actions', () => {
    useAppStore.getState().signIn('tok-123', { id: 'u1', email: 'a@b.c' });

    expect(useAppStore.getState().token).toBe('tok-123');
    expect(useAppStore.getState().userId).toBe('u1');
    expect(useAppStore.getState().isAuthenticated).toBe(true);
    expect(selectAuthToken(useAppStore.getState())).toBe('tok-123');
    expect(selectIsAuthenticated(useAppStore.getState())).toBe(true);
    expect(selectUserId(useAppStore.getState())).toBe('u1');
  });

  it('signs out and clears auth state', () => {
    useAppStore.getState().signIn('tok', { id: 'u1', email: 'a@b.c' });
    useAppStore.getState().signOut();

    expect(useAppStore.getState().isAuthenticated).toBe(false);
    expect(useAppStore.getState().token).toBeNull();
    expect(selectIsAuthenticated(useAppStore.getState())).toBe(false);
  });

  it('maintains the user slice independently from auth', () => {
    useAppStore.getState().setUser({
      id: 'u1',
      email: 'a@b.c',
      name: 'Alice',
    } as UserProfile);

    expect(useAppStore.getState().user).not.toBeNull();
    expect(useAppStore.getState().user?.id).toBe('u1');
  });

  it('updates subscription tier via setSubscriptionTier', () => {
    useAppStore.getState().setSubscriptionTier(SubscriptionTier.PRO);
    expect(useAppStore.getState().subscriptionTier).toBe(SubscriptionTier.PRO);
  });

  it('settings slice persists preferred currency and triggers actions', () => {
    useAppStore.getState().setPreferredCurrency('EUR');

    expect(useAppStore.getState().preferredCurrency).toBe('EUR');
    expect(selectPreferredCurrency(useAppStore.getState())).toBe('EUR');
  });

  it('network slice can be set', () => {
    useAppStore.setState({ currentNetwork: { id: 'mainnet', name: 'Mainnet' } as never });
    expect(selectCurrentNetwork(useAppStore.getState())).not.toBeNull();
  });

  it('transaction slice adds and queries transactions', () => {
    const tx = useAppStore.getState().addTransaction({
      subscriptionId: 'sub-1',
      amount: 10,
      currency: 'USD',
      status: TransactionStatus.SUCCESS,
    } as never);

    expect(useAppStore.getState().transactions).toHaveLength(1);
    expect(selectTransactions(useAppStore.getState())).toHaveLength(1);
    expect(useAppStore.getState().getBySubscription('sub-1')).toHaveLength(1);
    expect(tx.id).toBeDefined();
  });

  it('clears transaction history', () => {
    useAppStore.getState().addTransaction({
      subscriptionId: 'sub-1',
      amount: 1,
      currency: 'USD',
      status: TransactionStatus.SUCCESS,
    } as never);

    useAppStore.getState().clearHistory();
    expect(useAppStore.getState().transactions).toHaveLength(0);
  });
});
