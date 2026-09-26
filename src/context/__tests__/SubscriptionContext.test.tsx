import React from 'react';
import { renderHook, act } from '@testing-library/react-hooks';
import {
  SubscriptionProvider,
  useSubscriptionContext,
  useSubscriptions,
  useSubscriptionStats,
  useSubscriptionStatus,
} from '../SubscriptionContext';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <SubscriptionProvider>{children}</SubscriptionProvider>
);

describe('SubscriptionContext', () => {
  it('should provide subscription context values', () => {
    const { result } = renderHook(() => useSubscriptionContext(), { wrapper });

    expect(result.current.subscriptions).toBeDefined();
    expect(result.current.stats).toBeDefined();
    expect(typeof result.current.addSubscription).toBe('function');
    expect(typeof result.current.getActiveSubscriptions).toBe('function');
  });

  it('should filter subscriptions using useSubscriptions hook', () => {
    const { result } = renderHook(
      () =>
        useSubscriptions({
          category: SubscriptionCategory.ENTERTAINMENT,
          billingCycle: BillingCycle.MONTHLY,
        }),
      { wrapper }
    );

    expect(Array.isArray(result.current)).toBe(true);
  });

  it('should provide stats and status hooks', () => {
    const { result: statsResult } = renderHook(() => useSubscriptionStats(), { wrapper });
    expect(statsResult.current).toBeDefined();

    const { result: statusResult } = renderHook(() => useSubscriptionStatus(), { wrapper });
    expect(statusResult.current.isLoading).toBeDefined();
  });
});
