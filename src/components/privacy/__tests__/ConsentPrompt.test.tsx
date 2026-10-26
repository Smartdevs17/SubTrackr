import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ConsentPrompt } from '../ConsentPrompt';
import { allConsent, ConsentStorage, createConsentService } from '../../../services/consentService';
import { useAppStore } from '../../../store/slices';

// Swap native components that cannot load under Jest for inspectable host elements.
jest.mock('react-native/Libraries/Components/Switch/Switch', () =>
  require('./mockHostComponent').mockHostComponent('Switch')
);
jest.mock('react-native/Libraries/Components/Touchable/TouchableOpacity', () =>
  require('./mockHostComponent').mockHostComponent('TouchableOpacity')
);
jest.mock('react-native/Libraries/Modal/Modal', () =>
  require('./mockHostComponent').mockHostComponent('Modal')
);

jest.mock('../../../services/logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function memoryStorage(): ConsentStorage {
  const data: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => data[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
  };
}

async function renderPrompt(service: ReturnType<typeof createConsentService>) {
  const screen = render(<ConsentPrompt service={service} />);
  // Let the initial load settle.
  await act(async () => {
    await Promise.resolve();
  });
  return screen;
}

describe('ConsentPrompt', () => {
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

  it('asks for consent on first launch and records "Accept all"', async () => {
    const transport = jest.fn().mockResolvedValue(undefined);
    const service = createConsentService({ storage: memoryStorage(), transport });
    const screen = await renderPrompt(service);

    expect(screen.getByTestId('consent-prompt')).toBeTruthy();
    expect(screen.getByText('Your privacy choices')).toBeTruthy();

    fireEvent.press(screen.getByTestId('consent-accept-all'));

    await waitFor(() => expect(screen.queryByTestId('consent-prompt')).toBeNull());
    expect(useAppStore.getState().consent).toEqual({
      ...allConsent(true),
      hasAcceptedPolicy: true,
    });
    expect(transport.mock.calls[0][2]).toHaveLength(3);
    expect(transport.mock.calls[0][2][0].source).toBe('banner');
  });

  it('lets the user reject all optional processing as easily as accepting', async () => {
    const service = createConsentService({ storage: memoryStorage(), transport: jest.fn() });
    const screen = await renderPrompt(service);

    fireEvent.press(screen.getByTestId('consent-reject-all'));

    await waitFor(() => expect(screen.queryByTestId('consent-prompt')).toBeNull());
    expect(useAppStore.getState().consent).toEqual({
      ...allConsent(false),
      hasAcceptedPolicy: true,
    });
  });

  it('saves a customized selection with nothing pre-ticked', async () => {
    const service = createConsentService({ storage: memoryStorage(), transport: jest.fn() });
    const screen = await renderPrompt(service);

    expect(screen.queryByTestId('consent-prompt-categories')).toBeNull();
    fireEvent.press(screen.getByTestId('consent-customize'));

    expect(screen.getByTestId('consent-prompt-analytics-switch').props.value).toBe(false);
    expect(screen.getByTestId('consent-prompt-marketing-switch').props.value).toBe(false);
    expect(screen.getByTestId('consent-prompt-notifications-switch').props.value).toBe(false);

    act(() => {
      screen.getByTestId('consent-prompt-notifications-switch').props.onValueChange(true);
    });
    fireEvent.press(screen.getByTestId('consent-save-choices'));

    await waitFor(() => expect(screen.queryByTestId('consent-prompt')).toBeNull());
    expect(useAppStore.getState().consent).toEqual({
      analytics: false,
      marketing: false,
      notifications: true,
      hasAcceptedPolicy: true,
    });
  });

  it('stays hidden when consent exists for the current policy', async () => {
    const storage = memoryStorage();
    const service = createConsentService({ storage, transport: jest.fn() });
    await service.save('user-1', allConsent(false), 'banner');

    const screen = await renderPrompt(service);

    expect(screen.queryByTestId('consent-prompt')).toBeNull();
  });

  it('re-prompts when the privacy policy version changes', async () => {
    const storage = memoryStorage();
    await createConsentService({ storage, transport: jest.fn(), policyVersion: 'v1' }).save(
      'user-1',
      allConsent(true),
      'banner'
    );
    const service = createConsentService({ storage, transport: jest.fn(), policyVersion: 'v2' });

    const screen = await renderPrompt(service);

    expect(screen.getByText('Our privacy policy has changed')).toBeTruthy();
    expect(useAppStore.getState().consent.hasAcceptedPolicy).toBe(false);
  });

  it('stays open and shows an error when the choice cannot be saved', async () => {
    const storage = memoryStorage();
    (storage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage is full'));
    const service = createConsentService({ storage, transport: jest.fn() });
    const screen = await renderPrompt(service);

    fireEvent.press(screen.getByTestId('consent-accept-all'));

    await waitFor(() => expect(screen.getByTestId('consent-prompt-error')).toBeTruthy());
    expect(screen.getByText('Storage is full')).toBeTruthy();
    expect(screen.getByTestId('consent-prompt')).toBeTruthy();
    expect(useAppStore.getState().consent.hasAcceptedPolicy).toBe(false);
  });

  it('does not block the app when consent cannot be loaded', async () => {
    const storage = memoryStorage();
    (storage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
    const service = createConsentService({ storage, transport: jest.fn() });

    const screen = await renderPrompt(service);

    expect(screen.queryByTestId('consent-prompt')).toBeNull();
  });
});
