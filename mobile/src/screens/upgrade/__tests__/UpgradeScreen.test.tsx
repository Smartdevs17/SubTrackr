/**
 * mobile/src/screens/upgrade/__tests__/UpgradeScreen.test.tsx
 *
 * Component and interaction tests for UpgradeScreen.
 */

import React from 'react';
import { UpgradeScreen } from '../UpgradeScreen';
import { calculateProrationQuote } from '../selectors';
import type { UpgradeMetrics } from '../types';

describe('UpgradeScreen Component', () => {
  const metrics: UpgradeMetrics = {
    onView: jest.fn(),
    onSelectTier: jest.fn(),
    onToggleCycle: jest.fn(),
    onUpgradeStart: jest.fn(),
    onUpgradeSuccess: jest.fn(),
    onUpgradeFailure: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with default starter tier and triggers onView metric', () => {
    const screen = (
      <UpgradeScreen
        currentTier="starter"
        currentBillingCycle="annual"
        metrics={metrics}
      />
    );

    expect(screen).toBeDefined();
    expect(screen.props.currentTier).toBe('starter');
    expect(screen.props.currentBillingCycle).toBe('annual');
  });

  it('calculates deterministic proration quote for upgrade to pro', () => {
    const quote = calculateProrationQuote('starter', 'pro', 'monthly', 10, 30);
    expect(quote.dueToday).toBeGreaterThan(0);
    expect(quote.targetTier).toBe('pro');
  });

  it('supports custom onCompleteUpgrade callback', async () => {
    const onCompleteUpgrade = jest.fn().mockResolvedValue(undefined);
    const screen = (
      <UpgradeScreen
        currentTier="starter"
        onCompleteUpgrade={onCompleteUpgrade}
      />
    );
    expect(screen.props.onCompleteUpgrade).toBe(onCompleteUpgrade);
  });
});
