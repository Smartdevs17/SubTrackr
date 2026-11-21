/**
 * Tests for TemplateVersionHistoryScreen (#1748)
 *
 * Drives the real notification template store and asserts the version timeline,
 * the current marker and rollback behaviour.
 */

import React from 'react';

import { render, fireEvent, act } from '../../test-utils';
import TemplateVersionHistoryScreen from '../TemplateVersionHistoryScreen';
import { useNotificationTemplateStore } from '../../store/notificationTemplateStore';

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

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useRoute: () => ({ params: { type: 'renewal_reminder', channel: 'email' } }),
  };
});

const store = () => useNotificationTemplateStore.getState();

const draft = (overrides: Record<string, unknown> = {}) => ({
  type: 'renewal_reminder' as const,
  channel: 'email' as const,
  subject: 'Renewal soon',
  body: 'Hi {{name}}',
  variables: ['name'],
  ...overrides,
});

beforeEach(() => {
  useNotificationTemplateStore.setState({ versions: {} });
});

describe('TemplateVersionHistoryScreen', () => {
  it('shows an empty state with no versions', () => {
    const screen = render(<TemplateVersionHistoryScreen />);
    expect(screen.getByTestId('template-versions-empty')).toBeTruthy();
  });

  it('lists versions and marks the current one', () => {
    act(() => {
      store().saveDraft(draft({ subject: 'v1' }));
      store().saveDraft(draft({ subject: 'v2' }));
    });
    const screen = render(<TemplateVersionHistoryScreen />);

    expect(screen.getByTestId('template-version-1')).toBeTruthy();
    expect(screen.getByTestId('template-version-2')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    // Only the non-current version offers a rollback.
    expect(screen.queryByTestId('template-rollback-2')).toBeNull();
    expect(screen.getByTestId('template-rollback-1')).toBeTruthy();
  });

  it('rolls back to an earlier version', () => {
    act(() => {
      store().saveDraft(draft({ subject: 'Good' }));
      store().saveDraft(draft({ subject: 'Bad' }));
    });
    const screen = render(<TemplateVersionHistoryScreen />);

    fireEvent.press(screen.getByTestId('template-rollback-1'));

    const versions = store().listVersions('renewal_reminder', 'email');
    expect(versions).toHaveLength(3);
    expect(versions[2]!.subject).toBe('Good');
    expect(screen.getByText('Restored from v1')).toBeTruthy();
  });
});
