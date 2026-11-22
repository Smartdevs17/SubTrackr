import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import {
  FundingReminderScreen,
  formatMinor,
  type FundingReminderData,
} from '../FundingReminderScreen';

function reminder(overrides: Partial<FundingReminderData> = {}): FundingReminderData {
  return {
    level: 'warning',
    balanceMinor: 1000,
    currency: 'USD',
    shortfallSubscriptionId: 'sub-1',
    shortfallDueAt: '2026-11-25T12:00:00Z',
    shortfallMinor: 1500,
    recommendedTopUpMinor: 1575,
    remindAt: '2026-11-22T12:00:00Z',
    runwayDays: 3,
    horizonCharges: 2,
    coveredSubscriptionIds: [],
    ...overrides,
  };
}

describe('formatMinor', () => {
  it('formats minor units as currency', () => {
    expect(formatMinor(1575, 'USD')).toBe('$15.75');
  });

  it('honours a different minor-unit exponent', () => {
    expect(formatMinor(1500, 'JPY', 0)).toContain('1,500');
  });

  it('falls back for non-ISO asset codes', () => {
    expect(formatMinor(2500000, 'USDC-STELLAR', 7)).toBe('0.2500000 USDC-STELLAR');
  });
});

describe('<FundingReminderScreen />', () => {
  it('renders a warning with the shortfall, due date and suggested top-up', () => {
    const view = render(<FundingReminderScreen reminder={reminder()} />);
    expect(view.getByText('Balance running low')).toBeTruthy();
    const body = view.getByTestId('funding-reminder-body').props.children;
    expect(body).toContain('$10.00');
    expect(body).toContain('$15.00');
    expect(body).toContain('Nov');
    expect(view.getByText('Top up $15.75')).toBeTruthy();
    expect(view.getByTestId('funding-reminder-runway')).toBeTruthy();
  });

  it('renders an urgent alert with a distinct title', () => {
    const view = render(<FundingReminderScreen reminder={reminder({ level: 'urgent' })} />);
    expect(view.getByText('Top up now')).toBeTruthy();
    expect(view.getByTestId('funding-reminder').props.accessibilityRole).toBe('alert');
  });

  it('passes the recommended amount and currency to onTopUp', () => {
    const onTopUp = jest.fn();
    const view = render(<FundingReminderScreen reminder={reminder()} onTopUp={onTopUp} />);
    fireEvent.press(view.getByTestId('funding-reminder-topup'));
    expect(onTopUp).toHaveBeenCalledWith(1575, 'USD');
  });

  it('shows the dismiss action only when a handler is given', () => {
    const onDismiss = jest.fn();
    const without = render(<FundingReminderScreen reminder={reminder()} />);
    expect(without.queryByTestId('funding-reminder-dismiss')).toBeNull();
    const withHandler = render(<FundingReminderScreen reminder={reminder()} onDismiss={onDismiss} />);
    fireEvent.press(withHandler.getByTestId('funding-reminder-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('hides the runway line when it is unknown', () => {
    const view = render(<FundingReminderScreen reminder={reminder({ runwayDays: null })} />);
    expect(view.queryByTestId('funding-reminder-runway')).toBeNull();
  });

  it('shows a quiet confirmation for a funded wallet, with no top-up button', () => {
    const view = render(
      <FundingReminderScreen reminder={reminder({ level: 'ok', horizonCharges: 1 })} />,
    );
    expect(view.getByText('Wallet is funded')).toBeTruthy();
    expect(view.getByTestId('funding-reminder-body').props.children).toContain('1 charge.');
    expect(view.queryByTestId('funding-reminder-topup')).toBeNull();
  });
});
