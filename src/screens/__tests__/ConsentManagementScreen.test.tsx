import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import ConsentManagementScreen from '../ConsentManagementScreen';
import {
  allConsent,
  CONSENT_STORAGE_KEY,
  ConsentStorage,
  createConsentService,
} from '../../services/consentService';
import { useAppStore } from '../../store/slices';

// Swap native components that cannot load under Jest for inspectable host elements.
jest.mock('react-native/Libraries/Components/Switch/Switch', () =>
  require('../../components/privacy/__tests__/mockHostComponent').mockHostComponent('Switch')
);
jest.mock('react-native/Libraries/Components/Touchable/TouchableOpacity', () =>
  require('../../components/privacy/__tests__/mockHostComponent').mockHostComponent(
    'TouchableOpacity'
  )
);
jest.mock('react-native/Libraries/Modal/Modal', () =>
  require('../../components/privacy/__tests__/mockHostComponent').mockHostComponent('Modal')
);

jest.mock('../../services/logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function memoryStorage(): ConsentStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: jest.fn(async (key: string) => data[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
  };
}

type Queries = ReturnType<typeof render>;

function toggle(screen: Queries, testID: string, value: boolean) {
  const node = screen.getByTestId(`${testID}-switch`);
  act(() => {
    node.props.onValueChange(value);
  });
}

async function setup({ seed }: { seed?: ReturnType<typeof allConsent> } = {}) {
  const storage = memoryStorage();
  const transport = jest.fn().mockResolvedValue(undefined);
  const service = createConsentService({ storage, transport });
  if (seed) {
    await service.save('user-1', seed, 'banner');
    transport.mockClear();
  }
  const screen = render(<ConsentManagementScreen service={service} />);
  await waitFor(() => expect(screen.getByTestId('consent-management-screen')).toBeTruthy());
  return { screen, storage, transport, service };
}

describe('ConsentManagementScreen', () => {
  beforeEach(() => {
    useAppStore.setState({
      userId: 'user-1',
      consent: {
        analytics: false,
        marketing: false,
        notifications: true,
        hasAcceptedPolicy: false,
      },
    });
  });

  it('shows saved preferences with essential processing locked on', async () => {
    const { screen } = await setup({
      seed: { analytics: true, marketing: false, notifications: true },
    });

    expect(screen.getByTestId('consent-essential-switch').props.value).toBe(true);
    expect(screen.getByTestId('consent-essential-switch').props.disabled).toBe(true);
    expect(screen.getByTestId('consent-analytics-switch').props.value).toBe(true);
    expect(screen.getByTestId('consent-marketing-switch').props.value).toBe(false);
    expect(screen.getByTestId('consent-save').props.accessibilityState.disabled).toBe(true);
    expect(useAppStore.getState().consent).toEqual({
      analytics: true,
      marketing: false,
      notifications: true,
      hasAcceptedPolicy: true,
    });
  });

  it('saves changed preferences, records history, and updates the app store', async () => {
    const { screen, transport } = await setup({ seed: allConsent(false) });

    toggle(screen, 'consent-marketing', true);
    expect(screen.getByTestId('consent-save').props.accessibilityState.disabled).toBe(false);

    fireEvent.press(screen.getByTestId('consent-save'));

    await waitFor(() => expect(useAppStore.getState().consent.marketing).toBe(true));
    expect(transport).toHaveBeenCalledWith(
      'user-1',
      { analytics: false, marketing: true, notifications: false },
      [expect.objectContaining({ category: 'marketing', granted: true, source: 'settings' })]
    );
    expect(screen.getByText('Marketing: Granted')).toBeTruthy();
    expect(screen.getByTestId('consent-save').props.accessibilityState.disabled).toBe(true);
  });

  it('withdraws all optional consent in one step', async () => {
    const { screen } = await setup({ seed: allConsent(true) });

    fireEvent.press(screen.getByTestId('consent-withdraw-all'));

    await waitFor(() =>
      expect(useAppStore.getState().consent).toEqual({
        analytics: false,
        marketing: false,
        notifications: false,
        hasAcceptedPolicy: true,
      })
    );
    expect(screen.getByTestId('consent-analytics-switch').props.value).toBe(false);
  });

  it('shows an empty history before any decision', async () => {
    const { screen } = await setup();
    expect(screen.getByText('No consent decisions recorded yet.')).toBeTruthy();
    expect(screen.getByTestId('consent-save').props.accessibilityState.disabled).toBe(false);
  });

  it('shows a pending-sync notice when the backend is unreachable and clears it on retry', async () => {
    const { screen, transport } = await setup({ seed: allConsent(false) });
    transport.mockRejectedValueOnce(new Error('offline'));

    fireEvent.press(screen.getByTestId('consent-accept-all'));

    await waitFor(() => expect(screen.getByTestId('consent-pending-sync')).toBeTruthy());
    // The choice still applies locally even though it has not synced.
    expect(useAppStore.getState().consent.analytics).toBe(true);

    fireEvent.press(screen.getByTestId('consent-retry-sync'));

    await waitFor(() => expect(screen.queryByTestId('consent-pending-sync')).toBeNull());
  });

  it('shows an error and keeps the draft when saving fails', async () => {
    const { screen, storage } = await setup({ seed: allConsent(false) });
    (storage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage is full'));

    toggle(screen, 'consent-analytics', true);
    fireEvent.press(screen.getByTestId('consent-save'));

    await waitFor(() => expect(screen.getByTestId('consent-save-error')).toBeTruthy());
    expect(screen.getByText('Storage is full')).toBeTruthy();
    expect(screen.getByTestId('consent-analytics-switch').props.value).toBe(true);
    expect(useAppStore.getState().consent.analytics).toBe(false);
  });

  it('shows a retryable error when preferences cannot be loaded', async () => {
    const storage = memoryStorage();
    storage.data[CONSENT_STORAGE_KEY] = JSON.stringify({
      policyVersion: 'x',
      updatedAt: 'x',
      preferences: allConsent(true),
      history: [],
      pendingRecords: [],
    });
    (storage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
    const service = createConsentService({ storage, transport: jest.fn() });

    const screen = render(<ConsentManagementScreen service={service} />);

    await waitFor(() => expect(screen.getByTestId('consent-load-error')).toBeTruthy());
    expect(screen.getByText('Storage unavailable')).toBeTruthy();

    fireEvent.press(screen.getByTestId('consent-reload'));

    await waitFor(() => expect(screen.getByTestId('consent-management-screen')).toBeTruthy());
    expect(screen.getByTestId('consent-analytics-switch').props.value).toBe(true);
  });
});
