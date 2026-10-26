/**
 * SmsConsentScreen (#1747)
 *
 * Covers: loading consent records, opted-out/opted-in status display, source
 * attribution, toggling consent (calls the service and updates the ledger),
 * history expansion, the empty state and error handling.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '../../test-utils';

import SmsConsentScreen, { type SmsConsentService } from '../SmsConsentScreen';
import { useSmsConsentStore, type SmsConsentRecord } from '../../store/smsConsentStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('react-native/Libraries/Components/Touchable/TouchableOpacity', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  require('../../components/privacy/__tests__/mockHostComponent').mockHostComponent(
    'TouchableOpacity'
  )
);

const record = (overrides: Partial<SmsConsentRecord> = {}): SmsConsentRecord => ({
  phone: '+15550001111',
  status: 'opted_in',
  userId: 'user-1',
  source: 'web_form',
  explicitOptIn: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function makeService(records: SmsConsentRecord[] = [record()]): SmsConsentService & {
  setStatus: jest.Mock;
  listForUser: jest.Mock;
  historyFor: jest.Mock;
} {
  return {
    listForUser: jest.fn(async () => records),
    historyFor: jest.fn(async () => []),
    setStatus: jest.fn(async (phone: string, status: 'opted_in' | 'opted_out') =>
      record({ phone, status, source: 'web_form', updatedAt: '2026-04-01T00:00:00.000Z' })
    ),
  } as unknown as SmsConsentService & {
    setStatus: jest.Mock;
    listForUser: jest.Mock;
    historyFor: jest.Mock;
  };
}

async function setup(service = makeService()) {
  const screen = render(<SmsConsentScreen userId="user-1" service={service} />);
  await waitFor(() => expect(screen.getByTestId('sms-consent-screen')).toBeTruthy());
  return { screen, service };
}

beforeEach(() => {
  useSmsConsentStore.setState({ consents: [], events: [] });
});

describe('SmsConsentScreen', () => {
  it('lists consent records with their source', async () => {
    const { screen } = await setup();
    await waitFor(() => expect(screen.getByText('+15550001111')).toBeTruthy());
    expect(screen.getByText(/Web form/)).toBeTruthy();
    expect(screen.getByText('Opted in')).toBeTruthy();
  });

  it('shows an empty state when there are no numbers', async () => {
    const { screen } = await setup(makeService([]));
    await waitFor(() => expect(screen.getByTestId('sms-consent-empty')).toBeTruthy());
  });

  it('surfaces a load error', async () => {
    const service = makeService();
    (service.listForUser as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const { screen } = await setup(service as SmsConsentService);
    await waitFor(() => expect(screen.getByTestId('sms-consent-error')).toBeTruthy());
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('opts a number out and updates the ledger', async () => {
    const { screen, service } = await setup();
    await waitFor(() => expect(screen.getByTestId('sms-consent-toggle-+15550001111')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('sms-consent-toggle-+15550001111'));
    });

    expect(service.setStatus).toHaveBeenCalledWith('+15550001111', 'opted_out', 'web_form');
    await waitFor(() => expect(screen.getByText('Opted out')).toBeTruthy());
    expect(useSmsConsentStore.getState().isOptedOut('+15550001111')).toBe(true);
  });

  it('rewrites the button label after an opt-out', async () => {
    const { screen } = await setup(makeService([record({ status: 'opted_out' })]));
    await waitFor(() => expect(screen.getByText('Opt back in')).toBeTruthy());
  });

  it('expands the consent history for a number', async () => {
    const service = makeService();
    (service.historyFor as jest.Mock).mockResolvedValueOnce([
      {
        phone: '+15550001111',
        userId: 'user-1',
        status: 'opted_out',
        source: 'inbound_sms',
        reason: 'inbound STOP',
        at: '2026-02-01T00:00:00.000Z',
      },
    ]);
    const { screen } = await setup(service as SmsConsentService);
    await waitFor(() =>
      expect(screen.getByTestId('sms-consent-history-toggle-+15550001111')).toBeTruthy()
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('sms-consent-history-toggle-+15550001111'));
    });

    // Expanding reads the local ledger; seed it so the row renders.
    await act(async () => {
      useSmsConsentStore.setState({
        events: [
          {
            phone: '+15550001111',
            userId: 'user-1',
            status: 'opted_out',
            source: 'inbound_sms',
            reason: 'inbound STOP',
            at: '2026-02-01T00:00:00.000Z',
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('sms-consent-history-+15550001111')).toBeTruthy()
    );
  });

  it('surfaces an update error', async () => {
    const service = makeService();
    (service.setStatus as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    const { screen } = await setup(service as SmsConsentService);
    await waitFor(() => expect(screen.getByTestId('sms-consent-toggle-+15550001111')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('sms-consent-toggle-+15550001111'));
    });

    await waitFor(() => expect(screen.getByText(/nope/)).toBeTruthy());
  });
});
