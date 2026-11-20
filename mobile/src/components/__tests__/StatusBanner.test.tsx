import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import type { ProviderStatusSnapshot } from '../../../../backend/src/services/providerStatus';
import { BIDI_MARKERS } from '../../../../src/i18n/pipeline';
import { StatusBanner } from '../StatusBanner';

function snapshot(overrides: Partial<ProviderStatusSnapshot> = {}): ProviderStatusSnapshot {
  return {
    overall: 'outage',
    providers: [
      {
        providerId: 'stripe',
        status: 'outage',
        consecutiveFailures: 4,
        failureRate: 1,
        updatedAt: '2026-11-20T10:00:00.000Z',
      },
    ],
    activeOutages: ['stripe'],
    updatedAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('<StatusBanner />', () => {
  it('renders an accessible outage alert with affected providers', () => {
    const view = render(<StatusBanner snapshot={snapshot()} />);

    expect(view.getByTestId('status-banner-message')).toBeTruthy();
    expect(view.getByText(/Service status/)).toBeTruthy();
    expect(view.getByText(/We are experiencing a service outage/)).toBeTruthy();
    expect(view.getByTestId('status-banner-affected')).toBeTruthy();
  });

  it('wires retry and dismiss callbacks', () => {
    const onRetry = jest.fn();
    const onDismiss = jest.fn();
    const view = render(
      <StatusBanner snapshot={snapshot()} onRetry={onRetry} onDismiss={onDismiss} />,
    );

    fireEvent.press(view.getByTestId('status-banner-retry'));
    fireEvent.press(view.getByTestId('status-banner-dismiss'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while all providers are operational', () => {
    const view = render(<StatusBanner snapshot={snapshot({ overall: 'operational' })} />);
    expect(view.queryByTestId('status-banner')).toBeNull();
  });

  it('isolates Latin provider names inside RTL text', () => {
    const view = render(<StatusBanner snapshot={snapshot()} locale="ar-SA" />);
    const affected = view.getByTestId('status-banner-affected');

    expect(JSON.stringify(affected)).toContain(BIDI_MARKERS.fsi);
  });

  it('lists every degraded provider', () => {
    const view = render(
      <StatusBanner
        snapshot={snapshot({
          overall: 'degraded',
          activeOutages: [],
          providers: [
            {
              providerId: 'paypal',
              status: 'degraded',
              consecutiveFailures: 0,
              failureRate: 0.5,
            },
            {
              providerId: 'paddle',
              status: 'degraded',
              consecutiveFailures: 0,
              failureRate: 0.5,
            },
          ],
        })}
      />,
    );

    const label = JSON.stringify(view.getByTestId('status-banner-affected'));
    expect(label).toContain('paypal');
    expect(label).toContain('paddle');
  });
});
